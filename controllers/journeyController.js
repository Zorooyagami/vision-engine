const { getTopPaths, getPathDetail, getJourneyFlow } = require('../services/journeyPaths');

function commonOptions(req) {
  const { period, platform, device, personas, from, to } = req.query;
  return {
    projectId: req.projectId,
    period: period || '30d',
    customRange: from && to ? { from, to } : null,
    personas: personas ? personas.split(',').filter(Boolean) : [],
    platform: platform || 'combined',
    device: device || null,
  };
}

async function getTopPathsHandler(req, res) {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 4, 20));
    const data = await getTopPaths({ ...commonOptions(req), limit });
    res.json(data);
  } catch (err) {
    console.error('[journey] top paths failed', err);
    res.status(500).json({ error: 'Failed to compute top paths' });
  }
}

async function getPathDetailHandler(req, res) {
  try {
    const path = req.query.path;
    if (!path) {
      return res.status(400).json({ error: 'path query param required, e.g. PLP,PDP,Cart,Checkout,Purchase' });
    }
    const pathNodes = path.split(',').map((node) => node.trim()).filter(Boolean);
    const data = await getPathDetail({ ...commonOptions(req), pathNodes });
    res.json(data);
  } catch (err) {
    console.error('[journey] path detail failed', err);
    res.status(500).json({ error: 'Failed to compute path detail' });
  }
}

async function getJourneyFlowHandler(req, res) {
  try {
    const data = await getJourneyFlow(commonOptions(req));
    res.json(data);
  } catch (err) {
    console.error('[journey] flow failed', err);
    res.status(500).json({ error: 'Failed to compute journey flow' });
  }
}

module.exports = { getTopPathsHandler, getPathDetailHandler, getJourneyFlowHandler };
