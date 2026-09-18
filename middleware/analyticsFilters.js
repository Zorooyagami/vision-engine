// middleware/analyticsFilters.js
const { getPeriodRange, getPreviousRange } = require('../utils/periodUtils')
const { resolvePersonaMatch } = require('../services/personaResolver')

async function analyticsFilters(req, res, next) {
  try {
    const period = req.query.period || '7d'
    const persona = req.query.persona || 'all'

    const range = getPeriodRange(period) // null for 'all'
    const prevRange = getPreviousRange(range)

    const personaMatch = await resolvePersonaMatch(persona, range)
    const prevPersonaMatch = prevRange ? await resolvePersonaMatch(persona, prevRange) : null

    // baseMatch = ready-to-spread timestamp + persona filter for "current" window
    const baseMatch = {
      ...(range ? { timestamp: { $gte: range.from, $lte: range.to } } : {}),
      ...personaMatch,
    }
    const prevMatch = prevRange
      ? { timestamp: { $gte: prevRange.from, $lte: prevRange.to }, ...prevPersonaMatch }
      : null

    req.analytics = { period, persona, range, prevRange, baseMatch, prevMatch }
    next()
  } catch (err) {
    res.status(400).json({ error: `Invalid filter: ${err.message}` })
  }
}

module.exports = { analyticsFilters }