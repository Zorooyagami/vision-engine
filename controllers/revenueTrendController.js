const { getRevenueTrend } = require('../services/revenueTrend');

async function getTrend(req, res) {
  try {
    const { period, platform, device, personas, from, to } = req.query;
    const data = await getRevenueTrend({
      projectId: req.projectId,
      period: period || '30d',
      customRange: from && to ? { from, to } : null,
      personas: personas ? personas.split(',').filter(Boolean) : [],
      platform: platform || 'combined',
      device: device || null,
    });
    res.json({ data });
  } catch (err) {
    console.error('[revenue-trend] failed', err);
    res.status(500).json({ error: 'Failed to compute revenue trend' });
  }
}

module.exports = { getTrend };
