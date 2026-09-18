// controllers/funnelController.js
const { getFunnel } = require('../services/funnel');

async function getFunnelData(req, res) {
  try {
    const { period, platform, device, personas, from, to } = req.query;
    const customRange = from && to ? { from, to } : null;
    const personaList = personas ? personas.split(',').filter(Boolean) : [];

    const data = await getFunnel({
      period: period || '30d',
      customRange,
      personas: personaList,
      platform: platform || 'combined',
      device: device || null,
    });

    res.json({ data });
  } catch (err) {
    console.error('[funnel] failed', err);
    res.status(500).json({ error: 'Failed to compute funnel' });
  }
}

module.exports = { getFunnelData };