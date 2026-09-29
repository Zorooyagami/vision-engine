const { getPeriodRange, getPreviousRange } = require('../utils/periodUtils');
const { resolvePersonaMatch } = require('../services/personaResolver');

async function analyticsFilters(req, res, next) {
  try {
    const period = req.query.period || '7d';
    const persona = req.query.persona || 'all';
    const range = getPeriodRange(period);
    const prevRange = getPreviousRange(range);

    const personaMatch = await resolvePersonaMatch(req.projectId, persona, range);
    const prevPersonaMatch = prevRange
      ? await resolvePersonaMatch(req.projectId, persona, prevRange)
      : null;

    const baseMatch = {
      projectId: req.projectId,
      ...(range ? { timestamp: { $gte: range.from, $lte: range.to } } : {}),
      ...personaMatch,
    };

    const prevMatch = prevRange
      ? {
          projectId: req.projectId,
          timestamp: { $gte: prevRange.from, $lte: prevRange.to },
          ...prevPersonaMatch,
        }
      : null;

    req.analytics = { period, persona, range, prevRange, baseMatch, prevMatch };
    next();
  } catch (err) {
    res.status(400).json({ error: `Invalid filter: ${err.message}` });
  }
}

module.exports = { analyticsFilters };
