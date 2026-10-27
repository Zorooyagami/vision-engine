//routes/queryBuilder.js
const express = require('express')
const mongoose = require('mongoose')
const Event = require('../models/Event')
const SavedExploreQuery = require('../models/SavedExploreQuery')

const router = express.Router()
const MAX_CONDITIONS = 30
const MAX_GROUPS = 10
const MAX_ROWS = 100
const MAX_RANGE_DAYS = 366

// Client field names never become arbitrary MongoDB paths. Only these paths
// are accepted by the query compiler.
const FIELD_MAP = {
  platform: ['deviceInfo.platform', 'platform'],
  deviceType: ['deviceInfo.deviceType'],
  browser: ['browser', 'deviceInfo.browser'],
  country: ['deviceInfo.geo.country', 'deviceInfo.country'],
  city: ['deviceInfo.geo.city', 'deviceInfo.city'],
  event: ['event'],
  path: ['path', 'properties.path'],
  productCategory: ['properties.productCategory', 'properties.category', 'properties.subCategory'],
  revenue: ['properties.total', 'properties.amount', 'properties.revenue', 'properties.value'],
  userId: ['userId'],
}
const ALLOWED_OPERATORS = new Set(['is', 'is_not', 'contains', 'not_contains', 'gt', 'gte', 'lt', 'lte', 'set', 'not_set'])
const NUMERIC_FIELDS = new Set(['revenue'])
const TIME_RANGES = { 'Last 7 days': 7, 'Last 14 days': 14, 'Last 30 days': 30, 'Last 90 days': 90 }
const TIME_GROUPS = new Set(['Day', 'Week', 'Month'])

// Fields whose distinct values are served to the UI dropdowns (GET /options).
const OPTION_FIELDS = ['platform', 'deviceType', 'browser', 'country', 'city', 'event', 'path', 'productCategory']
const OPTION_LIMITS = { path: 100, city: 100, productCategory: 60 }
const OPTIONS_LOOKBACK_DAYS = 90
const OPTIONS_TTL_MS = 5 * 60 * 1000
const optionsCache = new Map() // projectId -> { at, data }

function badRequest(message) { const e = new Error(message); e.status = 400; return e }
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function fieldExists(path) { return { [path]: { $exists: true, $nin: [null, ''] } } }
function numericExpression(path) {
  return { $convert: { input: `$${path}`, to: 'double', onError: null, onNull: null } }
}
// Older event records store timestamp as an ISO string, newer ones as a Date.
function rangeClause(start, end) {
  return { $or: [
    { timestamp: { $gte: start, $lte: end } },
    { timestamp: { $gte: start.toISOString(), $lte: end.toISOString() } },
  ] }
}

function compileCondition(condition) {
  if (!condition || typeof condition !== 'object') throw badRequest('Each condition must be an object')
  const paths = FIELD_MAP[condition.field]
  const operator = condition.operator
  if (!paths) throw badRequest(`Unsupported filter field: ${String(condition.field)}`)
  if (!ALLOWED_OPERATORS.has(operator)) throw badRequest(`Unsupported operator: ${String(operator)}`)
  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
    if (!NUMERIC_FIELDS.has(condition.field)) throw badRequest('Numeric operators can only be used with Revenue')
  }
  if (operator === 'set' || operator === 'not_set') {
    const clauses = paths.map((path) => operator === 'set' ? fieldExists(path) : { $or: [{ [path]: { $exists: false } }, { [path]: null }, { [path]: '' }] })
    return operator === 'set' ? (clauses.length === 1 ? clauses[0] : { $or: clauses }) : { $and: clauses }
  }
  if (condition.value === undefined || condition.value === null || String(condition.value).trim() === '') throw badRequest(`A value is required for ${condition.field}`)
  if (String(condition.value).length > 200) throw badRequest('Filter values must be 200 characters or fewer')

  const value = NUMERIC_FIELDS.has(condition.field) ? Number(condition.value) : String(condition.value).trim()
  if (NUMERIC_FIELDS.has(condition.field) && !Number.isFinite(value)) throw badRequest('Revenue filter must be a valid number')

  // Legacy tracking clients sometimes send numeric values as strings. A normal
  // MongoDB $gt/$lt will not compare those consistently, so convert explicitly.
  if (NUMERIC_FIELDS.has(condition.field)) {
    const exprOperator = ({ gt: '$gt', gte: '$gte', lt: '$lt', lte: '$lte', is: '$eq', is_not: '$ne' })[operator]
    if (exprOperator) {
      const clauses = paths.map((path) => ({ $expr: { [exprOperator]: [numericExpression(path), value] } }))
      return operator === 'is_not' ? { $and: clauses } : { $or: clauses }
    }
  }

  const mongoOperator = ({ is: '$eq', is_not: '$ne', contains: '$regex', not_contains: '$not' })[operator]
  const clauses = paths.map((path) => {
    if (operator === 'contains') return { [path]: { $regex: escapeRegex(value), $options: 'i' } }
    if (operator === 'not_contains') return { [path]: { $not: { $regex: escapeRegex(value), $options: 'i' } } }
    // Text equality is case-insensitive to match values emitted by browser/app
    // SDKs that differ only in capitalization (e.g. web vs Web).
    if (operator === 'is') return { [path]: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } }
    if (operator === 'is_not') return { [path]: { $not: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } } }
    return { [path]: { [mongoOperator]: value } }
  })
  // Fallback fields (e.g. browser and geo) are treated as one logical field.
  if (operator === 'is_not' || operator === 'not_contains') return { $and: clauses }
  return clauses.length === 1 ? clauses[0] : { $or: clauses }
}

function compileConditionSet(conditions, logic, allowEmpty = true) {
  if (!Array.isArray(conditions)) throw badRequest('conditions must be an array')
  if (conditions.length > MAX_CONDITIONS) throw badRequest(`A query can contain at most ${MAX_CONDITIONS} conditions`)
  if (!conditions.length) return allowEmpty ? null : { _id: { $exists: true } }
  if (!['AND', 'OR'].includes(logic)) throw badRequest('Filter logic must be AND or OR')
  const compiled = conditions.map(compileCondition)
  return compiled.length === 1 ? compiled[0] : { [logic === 'AND' ? '$and' : '$or']: compiled }
}

function compileFilters(definition) {
  const top = compileConditionSet(definition.conditions || [], definition.logic || 'AND')
  const groups = definition.groups || []
  if (!Array.isArray(groups) || groups.length > MAX_GROUPS) throw badRequest(`A query can contain at most ${MAX_GROUPS} nested groups`)
  const parts = top ? [top] : []
  groups.forEach((group) => {
    const compiled = compileConditionSet(group.conditions || [], group.logic || 'AND', false)
    if (compiled) parts.push(compiled)
  })
  if (!parts.length) return null
  if (parts.length === 1) return parts[0]
  // Root logic combines top-level conditions as well as each nested group.
  return { [definition.logic === 'OR' ? '$or' : '$and']: parts }
}

function readDateRange(definition) {
  const days = TIME_RANGES[definition.timeRange] || 30
  const end = new Date()
  const start = new Date(end.getTime() - Math.min(days, MAX_RANGE_DAYS) * 86400000)
  return { start, end }
}

const toDate = { $convert: { input: '$timestamp', to: 'date', onError: null, onNull: null } }
function groupExpression(groupBy) {
  const map = {
    Persona: { $cond: [{ $or: [{ $eq: ['$userId', null] }, { $eq: ['$userId', ''] }] }, 'Guest', 'Identified user'] },
    Platform: { $ifNull: ['$deviceInfo.platform', { $ifNull: ['$platform', 'Unknown'] }] },
    'Device type': { $ifNull: ['$deviceInfo.deviceType', 'Unknown'] },
    Browser: { $ifNull: ['$browser', { $ifNull: ['$deviceInfo.browser', 'Unknown'] }] },
    Country: { $ifNull: ['$deviceInfo.geo.country', { $ifNull: ['$deviceInfo.country', 'Unknown'] }] },
    City: { $ifNull: ['$deviceInfo.geo.city', { $ifNull: ['$deviceInfo.city', 'Unknown'] }] },
    Event: { $ifNull: ['$event', 'Unknown'] },
    'Page path': { $ifNull: ['$path', { $ifNull: ['$properties.path', 'Unknown'] }] },
    Day: { $dateToString: { format: '%Y-%m-%d', date: toDate } },
    Week: { $dateToString: { format: '%G-W%V', date: toDate } },
    Month: { $dateToString: { format: '%Y-%m', date: toDate } },
  }
  if (!map[groupBy]) throw badRequest(`Unsupported groupBy: ${String(groupBy)}`)
  return map[groupBy]
}

function readDefinition(body) {
  const definition = body?.definition || body
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw badRequest('Query definition is required')
  const event = String(definition.event || '').trim()
  if (!event || (event !== '*' && event.length > 100)) throw badRequest('A valid event name is required')
  const groupBy = String(definition.groupBy || 'Platform')
  // Validate group before executing any query.
  groupExpression(groupBy)
  return { ...definition, event, groupBy }
}

function handleError(res, error, label) {
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message })
  if (error.code === 11000) return res.status(409).json({ error: 'A saved query with this name already exists in this project' })
  console.error(label, error)
  return res.status(500).json({ error: 'Query Builder request failed' })
}

// ---------------------------------------------------------------------------
// GET /options — distinct values (with counts) that power the UI dropdowns.
// Scoped to the project, last 90 days, cached for a few minutes.
// ---------------------------------------------------------------------------
router.get('/options', async (req, res) => {
  try {
    const key = String(req.projectId)
    const cached = optionsCache.get(key)
    if (cached && !req.query.refresh && Date.now() - cached.at < OPTIONS_TTL_MS) return res.json(cached.data)

    const end = new Date()
    const start = new Date(end.getTime() - OPTIONS_LOOKBACK_DAYS * 86400000)
    const facets = {}
    OPTION_FIELDS.forEach((field) => {
      // First non-null path wins (same fallback order as the filter compiler).
      const raw = FIELD_MAP[field].reduceRight((acc, path) => ({ $ifNull: [`$${path}`, acc] }), null)
      facets[field] = [
        { $project: { v: { $convert: { input: raw, to: 'string', onError: null, onNull: null } } } },
        { $match: { v: { $nin: [null, ''] } } },
        // Event names are matched exactly by /execute, so keep their casing;
        // everything else is de-duplicated case-insensitively.
        { $group: { _id: field === 'event' ? '$v' : { $toLower: '$v' }, label: { $first: '$v' }, count: { $sum: 1 } } },
        { $sort: { count: -1, label: 1 } },
        { $limit: OPTION_LIMITS[field] || 50 },
      ]
    })
    const [result] = await Event.aggregate([
      { $match: { projectId: req.projectId, ...rangeClause(start, end) } },
      { $facet: facets },
    ]).option({ maxTimeMS: 20000, allowDiskUse: true })

    const options = {}
    OPTION_FIELDS.forEach((field) => {
      options[field] = (result?.[field] || []).map((r) => ({ value: r.label, count: r.count }))
    })
    const data = { options, lookbackDays: OPTIONS_LOOKBACK_DAYS }
    optionsCache.set(key, { at: Date.now(), data })
    res.json(data)
  } catch (error) { handleError(res, error, '[query-builder:options]') }
})

router.post('/execute', async (req, res) => {
  try {
    const definition = readDefinition(req.body)
    const { start, end } = readDateRange(definition)
    // Keep project scoping at the outermost match.
    const match = { projectId: req.projectId, $and: [rangeClause(start, end)] }
    if (definition.event !== '*') match.event = definition.event
    const filters = compileFilters(definition)
    if (filters) match.$and.push(filters)
    const group = groupExpression(definition.groupBy)
    const isTimeSeries = TIME_GROUPS.has(definition.groupBy)

    const distinctCount = (field) => Event.aggregate([
      { $match: { ...match, [field]: { $exists: true, $nin: [null, ''] } } },
      { $group: { _id: `$${field}` } },
      { $count: 'n' },
    ]).option({ maxTimeMS: 20000 })

    const [rows, users, sessions] = await Promise.all([
      Event.aggregate([
        { $match: match },
        { $group: {
          _id: group,
          count: { $sum: 1 },
          revenue: { $sum: { $convert: { input: { $ifNull: ['$properties.total', { $ifNull: ['$properties.amount', { $ifNull: ['$properties.revenue', '$properties.value'] }] }] }, to: 'double', onError: 0, onNull: 0 } } },
          uniqueUsers: { $addToSet: '$userId' },
          uniqueSessions: { $addToSet: '$sessionId' },
        } },
        { $project: { _id: 0, name: { $ifNull: ['$_id', 'Unknown'] }, count: 1, revenue: { $round: ['$revenue', 2] }, uniqueUsers: { $size: '$uniqueUsers' }, uniqueSessions: { $size: '$uniqueSessions' } } },
        // Time series must be chronological; everything else is biggest-first.
        { $sort: isTimeSeries ? { name: 1 } : { count: -1, name: 1 } },
        { $limit: MAX_ROWS },
      ]).option({ maxTimeMS: 20000 }),
      distinctCount('userId'),
      distinctCount('sessionId'),
    ])

    const total = rows.reduce((sum, row) => sum + row.count, 0)
    const totals = {
      count: total,
      revenue: Number(rows.reduce((sum, row) => sum + (row.revenue || 0), 0).toFixed(2)),
      uniqueUsers: users[0]?.n || 0,
      uniqueSessions: sessions[0]?.n || 0,
    }

    let diagnostics
    if (total === 0) {
      const base = { projectId: req.projectId, $and: [rangeClause(start, end)] }
      const [projectEvents, eventsInRange, selectedEventInRange, eventsAfterFilters] = await Promise.all([
        Event.countDocuments({ projectId: req.projectId }),
        Event.countDocuments(base),
        Event.countDocuments(definition.event === '*' ? base : { ...base, event: definition.event }),
        Event.countDocuments(match),
      ])
      diagnostics = { projectEvents, eventsInRange, selectedEventInRange, eventsAfterFilters }
    }
    res.json({
      rows: rows.map((row, index) => ({ ...row, id: `${String(row.name)}-${index}`, percent: total ? Number((row.count / total * 100).toFixed(2)) : 0 })),
      total,
      totals,
      event: definition.event,
      groupBy: definition.groupBy,
      isTimeSeries,
      range: { from: start.toISOString(), to: end.toISOString() },
      truncated: rows.length === MAX_ROWS,
      ...(diagnostics ? { diagnostics } : {}),
    })
  } catch (error) { handleError(res, error, '[query-builder:execute]') }
})

router.get('/saved', async (req, res) => {
  try {
    const items = await SavedExploreQuery.find({ projectId: req.projectId }).sort({ updatedAt: -1 }).select('_id name definition createdAt updatedAt').lean()
    res.json({ items: items.map((item) => ({ id: String(item._id), label: item.name, name: item.name, definition: item.definition, createdAt: item.createdAt, updatedAt: item.updatedAt })) })
  } catch (error) { handleError(res, error, '[query-builder:saved:list]') }
})

router.post('/saved', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name || name.length > 80) throw badRequest('Query name must be between 1 and 80 characters')
    const definition = readDefinition({ definition: req.body?.definition })
    const item = await SavedExploreQuery.create({ projectId: req.projectId, name, definition })
    res.status(201).json({ id: String(item._id), label: item.name, name: item.name, definition: item.definition, createdAt: item.createdAt, updatedAt: item.updatedAt })
  } catch (error) { handleError(res, error, '[query-builder:saved:create]') }
})

router.delete('/saved/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw badRequest('Invalid saved query id')
    const deleted = await SavedExploreQuery.findOneAndDelete({ _id: req.params.id, projectId: req.projectId })
    if (!deleted) return res.status(404).json({ error: 'Saved query not found' })
    res.status(204).end()
  } catch (error) { handleError(res, error, '[query-builder:saved:delete]') }
})

module.exports = router