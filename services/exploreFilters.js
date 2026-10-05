// vision-engine/services/exploreFilters.js
// Reporting-filter helpers shared by explore routes.
// Same parsing rules as readFilters() in routes/exploreUsers.js, minus personas.
// exploreUsers.js can be switched to import from here later.

const Event = require('../models/Event')
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
} = require('./filterHelpers')

function invalid(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function scalar(value, name, fallback = '') {
  if (value === undefined) return fallback
  if (typeof value !== 'string') throw invalid(`${name} must be a string`)
  return value.trim()
}

// Mongoose does not cast aggregation $match values, so cast projectId
// according to the model's schema (ObjectId or String).
function projectFor(model, value) {
  if (value == null || value === '') throw invalid('Project is required')

  try {
    const schemaType = model.schema.path('projectId')
    return schemaType ? schemaType.cast(value) : value
  } catch {
    throw invalid('Invalid projectId')
  }
}

function readReportingFilters(req) {
  const query = req.query

  let period = scalar(query.period, 'period', '30d')
  if (period === '24h') period = '1d'

  if (!['1d', '7d', '30d', '90d', '180d', 'custom'].includes(period)) {
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

  let platform = scalar(query.platform, 'platform', 'combined').toLowerCase()
  if (platform === 'all') platform = 'combined'
  if (!['combined', 'web', 'app'].includes(platform)) {
    throw invalid('Invalid platform')
  }

  const devices = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' }
  const deviceKey = scalar(query.deviceType ?? query.device, 'device').toLowerCase()

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
    projectId: projectFor(Event, req.projectId),
  }
}

function baseMatch(filters) {
  const match = {
    projectId: filters.projectId,
    timestamp: { $gte: filters.start, $lt: filters.end },
  }
  applyPlatformDeviceFilter(match, filters.platform, filters.device)
  return match
}

module.exports = {
  invalid,
  scalar,
  projectFor,
  readReportingFilters,
  baseMatch,
}
