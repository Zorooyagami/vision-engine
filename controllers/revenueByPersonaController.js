const { getRevenueByPersona, getStackedRevenueByPersona } = require('../services/revenueByPersona');

function parseQuery(req) {
  const { period, platform, device, from, to } = req.query;
  return {
    projectId: req.projectId,
    period: period || '30d',
    customRange: from && to ? { from, to } : null,
    platform: platform || 'combined',
    device: device || null,
  };
}

async function getBreakdown(req, res) {
  try {
    const rows = await getRevenueByPersona(parseQuery(req));
    res.json({ rows });
  } catch (err) {
    console.error('[revenue] breakdown failed', err);
    res.status(500).json({ error: 'Failed to compute revenue breakdown' });
  }
}

async function getStacked(req, res) {
  try {
    const monthly = await getStackedRevenueByPersona(parseQuery(req));
    res.json({ monthly });
  } catch (err) {
    console.error('[revenue] stacked failed', err);
    res.status(500).json({ error: 'Failed to compute stacked revenue' });
  }
}

module.exports = { getBreakdown, getStacked };
