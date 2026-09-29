// controllers/personaOverviewController.js
const { getPersonaOverview } = require('../services/personaOverview');

async function getOverview(req, res) {
  try {
    const { period, platform, device, from, to } = req.query;
    const rows = await getPersonaOverview({
      period: period || '30d',
      customRange: from && to ? { from, to } : null,
      platform: platform || 'combined',
      device: device || null,
    });
    res.json({ rows });
  } catch (err) {
    console.error('[persona-overview] failed', err);
    res.status(500).json({ error: 'Failed to compute persona overview' });
  }
}

module.exports = { getOverview };