// controllers/revenueTrendController.js
const { getRevenueTrend } = require('../services/revenueTrend');

async function getTrend(req, res) {
  try {
    const { period, platform, device, personas, from, to } = req.query;
    const customRange = from && to ? { from, to } : null;
    const personaList = personas ? personas.split(',').filter(Boolean) : [];

    const data = await getRevenueTrend({
      period: period || '30d',
      customRange,
      personas: personaList,
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