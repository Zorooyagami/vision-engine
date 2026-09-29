const { getFunnel } = require('../services/funnel');

async function getFunnelData(req, res) {
  try {
    const { period, platform, device, personas, from, to } = req.query;
    const data = await getFunnel({
      projectId: req.projectId,
      period: period || '30d',
      customRange: from && to ? { from, to } : null,
      personas: personas ? personas.split(',').filter(Boolean) : [],
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
