// vision-engine/routes/exploreUsers.js
// Mount:
// app.use('/api/explore', requireProject, require('./routes/exploreUsers'))

const express = require('express')
const Event = require('../models/Event')
const User = require('../models/User')

const { classifyPersonas } = require('../services/aggregations')
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
} = require('../services/filterHelpers')

const router = express.Router()

const PERSONAS = ['loyal', 'firsttime', 'active', 'guest']

const SORT_FIELDS = {
  lastActive: 'lastActive',
  revenue: 'revenue',
  events: 'eventCount',
  sessions: 'sessions',
}

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 })
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function scalar(value, name, fallback = '') {
  if (value === undefined) return fallback

  if (typeof value !== 'string') {
    throw invalid(`${name} must be a string`)
  }

  return value.trim()
}

function parsePersonas(query) {
  // Supports:
  // personas=loyal,active
  // persona=loyal
  // selectedPersonas=loyal
  // personas=loyal&personas=active
  // firstTime is normalized to firsttime.
  const raw =
    query.personas ??
    query.persona ??
    query.selectedPersonas ??
    'all'

  const values = Array.isArray(raw) ? raw : [raw]

  const parts = values.flatMap((value) => {
    if (typeof value !== 'string') {
      throw invalid('Invalid personas')
    }

    return value
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  })

  const hasInvalidPersona = parts.some(
    (key) => key !== 'all' && !PERSONAS.includes(key),
  )

  if (hasInvalidPersona) {
    throw invalid(
      'Personas must be loyal, firsttime, active, guest, or all',
    )
  }

  if (!parts.length || parts.includes('all')) {
    return [...PERSONAS]
  }

  return [...new Set(parts)]
}

// Mongoose does not automatically cast aggregation match values.
// Cast projectId according to the model's schema.
function projectFor(model, value) {
  if (value == null || value === '') {
    throw invalid('Project is required')
  }

  try {
    const schemaType = model.schema.path('projectId')
    return schemaType ? schemaType.cast(value) : value
  } catch {
    throw invalid('Invalid projectId')
  }
}

function readFilters(req) {
  const query = req.query

  let period = scalar(query.period, 'period', '30d')

  if (period === '24h') {
    period = '1d'
  }

  const supportedPeriods = [
    '1d',
    '7d',
    '30d',
    '90d',
    '180d',
    'custom',
  ]

  if (!supportedPeriods.includes(period)) {
    throw invalid('Unsupported period')
  }

  let customRange

  if (period === 'custom') {
    const from = scalar(query.from, 'from')
    const to = scalar(query.to, 'to')

    const fromDate = new Date(from)
    const toDate = new Date(to)

    if (
      !from ||
      !to ||
      !Number.isFinite(fromDate.getTime()) ||
      !Number.isFinite(toDate.getTime()) ||
      fromDate > toDate
    ) {
      throw invalid('Provide valid from/to dates with from <= to')
    }

    customRange = { from, to }
  }

  // Reuse the same date boundaries as the dashboard.
  const { start, end } = resolveDateRange(period, customRange)

  if (
    !(start instanceof Date) ||
    !(end instanceof Date) ||
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end
  ) {
    throw invalid('Invalid reporting range')
  }

  let platform = scalar(
    query.platform,
    'platform',
    'combined',
  ).toLowerCase()

  if (platform === 'all') {
    platform = 'combined'
  }

  if (!['combined', 'web', 'app'].includes(platform)) {
    throw invalid('Invalid platform')
  }

  const deviceKey = scalar(
    query.deviceType ?? query.device,
    'device',
  ).toLowerCase()

  const devices = {
    desktop: 'Desktop',
    mobile: 'Mobile',
    tablet: 'Tablet',
  }

  if (
    deviceKey &&
    deviceKey !== 'all' &&
    !Object.prototype.hasOwnProperty.call(devices, deviceKey)
  ) {
    throw invalid('Invalid device')
  }

  return {
    start,
    end,
    platform,
    device: devices[deviceKey],
    personas: parsePersonas(query),
    projectId: projectFor(Event, req.projectId),
  }
}

function baseMatch(filters) {
  const match = {
    projectId: filters.projectId,
    timestamp: {
      $gte: filters.start,
      $lt: filters.end,
    },
  }

  applyPlatformDeviceFilter(
    match,
    filters.platform,
    filters.device,
  )

  return match
}

function cohortMatch(personas, cohorts) {
  const clauses = []

  const knownIds = personas
    .filter((persona) => persona !== 'guest')
    .flatMap((persona) => cohorts[persona] || [])

  if (knownIds.length) {
    clauses.push({
      userId: { $in: knownIds },
    })
  }

  if (personas.includes('guest')) {
    clauses.push({
      userId: null,
    })
  }

  // An empty selected cohort must return no events.
  return clauses.length
    ? { $or: clauses }
    : { userId: { $in: [] } }
}

function errorResponse(res, error, label) {
  if (error.status === 400) {
    return res.status(400).json({
      error: error.message,
    })
  }

  console.error(label, error)

  return res.status(500).json({
    error: 'Failed to load explorer data',
  })
}

// ---------------------------------------------------------------------
// GET /api/explore/users
// ---------------------------------------------------------------------
router.get('/users', async (req, res) => {
  try {
    const filters = readFilters(req)
    const search = scalar(req.query.search, 'search')
    const sort = scalar(req.query.sort, 'sort') // '' when not provided

    // Guests are never returned from this endpoint.
    const personas = filters.personas.filter((p) => p !== 'guest')

    if (!personas.length) {
      return res.json({ users: [] })
    }

    const cohorts = await classifyPersonas(
      filters.projectId,
      filters.start,
      filters.end,
    )

    const conditions = [
      baseMatch(filters),
      // Known users only (excludes null and missing userId).
      { userId: { $ne: null } },
      cohortMatch(personas, cohorts),
    ]

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i')

      const profiles = await User.find({
        projectId: projectFor(User, req.projectId),
        $or: [{ userId: regex }, { name: regex }, { email: regex }],
      })
        .select('userId -_id')
        .lean()

      const profileUserIds = profiles
        .map((user) => user.userId)
        .filter((id) => id != null)

      conditions.push({
        $or: [{ userId: regex }, { userId: { $in: profileUserIds } }],
      })
    }

    const pipeline = [
      { $match: { $and: conditions } },
      {
        $group: {
          _id: '$userId',
          eventCount: { $sum: 1 },
          sessionSet: { $addToSet: { $ifNull: ['$sessionId', null] } },
          lastActive: { $max: '$timestamp' },
          orders: {
            $sum: { $cond: [{ $eq: ['$event', 'purchase'] }, 1, 0] },
          },
          revenue: {
            $sum: {
              $cond: [
                { $eq: ['$event', 'purchase'] },
                {
                  $convert: {
                    input: '$properties.total',
                    to: 'double',
                    onError: 0,
                    onNull: 0,
                  },
                },
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          eventCount: 1,
          lastActive: 1,
          orders: 1,
          revenue: 1,
          sessions: {
            $size: { $setDifference: ['$sessionSet', [null, '']] },
          },
        },
      },
    ]

    // Only sort and cap when the caller asked for a sort.
    // No sort param -> all matching users, no limit.
    if (sort) {
      const sortField = Object.prototype.hasOwnProperty.call(SORT_FIELDS, sort)
        ? SORT_FIELDS[sort]
        : 'lastActive'

      pipeline.push({ $sort: { [sortField]: -1, _id: 1 } }, { $limit: 200 })
    }

    const stats = await Event.aggregate(pipeline).allowDiskUse(true)

    const knownIds = stats.map((stat) => stat._id)

    const profiles = knownIds.length
      ? await User.find({
          projectId: projectFor(User, req.projectId),
          userId: { $in: knownIds },
        })
          .select('userId name email -_id')
          .lean()
      : []

    const profileMap = new Map(profiles.map((u) => [String(u.userId), u]))

    const personaMap = new Map()
    for (const persona of ['active', 'firsttime', 'loyal']) {
      for (const id of cohorts[persona] || []) {
        personaMap.set(String(id), persona)
      }
    }

    const users = stats.map((stat) => {
      const userId = stat._id
      const profile = profileMap.get(String(userId)) || {}

      return {
        id: `user:${userId}`,
        userId,
        sessionId: null,
        isGuest: false,
        name: profile.name || null,
        email: profile.email || null,
        persona: personaMap.get(String(userId)) || 'active',
        sessions: stat.sessions,
        eventCount: stat.eventCount,
        orders: stat.orders,
        revenue: stat.revenue,
        lastActive: stat.lastActive,
        eventsUrl: `/api/explore/users/${encodeURIComponent(userId)}/events`,
      }
    })

    return res.json({ users })
  } catch (error) {
    return errorResponse(res, error, '[explore/users] failed')
  }
})
// ---------------------------------------------------------------------
// Shared events handler
// ---------------------------------------------------------------------
async function eventsHandler(req, res, guest) {
  try {
    const filters = readFilters(req)

    const requestedLimit = Number(
      scalar(req.query.limit, 'limit', '300'),
    )

    if (
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1
    ) {
      throw invalid('limit must be a positive integer')
    }

    const conditions = [
      baseMatch(filters),
    ]

    if (guest) {
      if (!filters.personas.includes('guest')) {
        return res.json({ events: [] })
      }

      // Return only anonymous events from this guest session.
      conditions.push({
        userId: null,
        sessionId: req.params.sessionId,
      })
    } else {
      const cohorts = await classifyPersonas(
        filters.projectId,
        filters.start,
        filters.end,
      )

      conditions.push(
        cohortMatch(filters.personas, cohorts),
        {
          userId: req.params.userId,
        },
      )
    }

    const events = await Event.find({
      $and: conditions,
    })
      .sort({
        timestamp: -1,
        _id: -1,
      })
      .limit(Math.min(requestedLimit, 1000))
      .select(
        'event sessionId timestamp path url properties deviceInfo -_id',
      )
      .lean()

    return res.json({ events })
  } catch (error) {
    return errorResponse(
      res,
      error,
      '[explore/events] failed',
    )
  }
}

// ---------------------------------------------------------------------
// GET /api/explore/users/:userId/events
// ---------------------------------------------------------------------
router.get('/users/:userId/events', (req, res) => {
  return eventsHandler(req, res, false)
})

// ---------------------------------------------------------------------
// GET /api/explore/sessions/:sessionId/events
// Guest session drilldown
// ---------------------------------------------------------------------
router.get('/sessions/:sessionId/events', (req, res) => {
  return eventsHandler(req, res, true)
})

module.exports = router

// Recommended indexes — add to schema files before mongoose.model():
//
// eventSchema.index({ projectId: 1, userId: 1, timestamp: -1 })
// eventSchema.index({ projectId: 1, event: 1, userId: 1 })
// eventSchema.index({ projectId: 1, sessionId: 1, timestamp: -1 })
// userSchema.index({ projectId: 1, userId: 1 })