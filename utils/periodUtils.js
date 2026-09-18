// utils/periodUtils.js

const PERIOD_DAYS = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 182, // approx 6 months
  '1y': 365,
}

/**
 * Resolves a period string (e.g. '7d', '30d', '6m') into a concrete
 * { from, to } date range ending now. Returns null for 'all' —
 * callers should treat null as "no timestamp filter".
 */
function getPeriodRange(period) {
  if (!period || period === 'all') return null

  const days = PERIOD_DAYS[period]
  if (!days) {
    throw new Error(`Unknown period: ${period}`)
  }

  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - days)

  return { from, to }
}

/**
 * Given a resolved range, returns the immediately preceding window
 * of equal length — used for period-over-period growth %.
 * Returns null if range is null (i.e. 'all' has no meaningful "previous").
 */
function getPreviousRange(range) {
  if (!range) return null
  const spanMs = range.to.getTime() - range.from.getTime()
  return {
    from: new Date(range.from.getTime() - spanMs),
    to: new Date(range.from.getTime()),
  }
}

module.exports = { getPeriodRange, getPreviousRange, PERIOD_DAYS }