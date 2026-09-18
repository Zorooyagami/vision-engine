// controllers/journeyController.js
const { getTopPaths, getPathDetail, getJourneyFlow } = require('../services/journeyPaths');

async function getTopPathsHandler(req, res) {
  try {
    const { period, platform, device, personas, from, to, limit } = req.query;
    const customRange = from && to ? { from, to } : null;
    const personaList = personas ? personas.split(',').filter(Boolean) : [];

    const data = await getTopPaths({
      period: period || '30d',
      customRange,
      personas: personaList,
      platform: platform || 'combined',
      device: device || null,
      limit: limit ? parseInt(limit, 10) : 4,
    });

    res.json(data);
  } catch (err) {
    console.error('[journey] top paths failed', err);
    res.status(500).json({ error: 'Failed to compute top paths' });
  }
}

async function getPathDetailHandler(req, res) {
  try {
    const { period, platform, device, personas, from, to, path } = req.query;
    if (!path) {
      return res.status(400).json({ error: 'path query param required, e.g. PLP,PDP,Cart,Checkout,Purchase' });
    }
    const customRange = from && to ? { from, to } : null;
    const personaList = personas ? personas.split(',').filter(Boolean) : [];
    const pathNodes = path.split(',').filter(Boolean);

    const data = await getPathDetail({
      period: period || '30d',
      customRange,
      personas: personaList,
      platform: platform || 'combined',
      device: device || null,
      pathNodes,
    });

    res.json(data);
  } catch (err) {
    console.error('[journey] path detail failed', err);
    res.status(500).json({ error: 'Failed to compute path detail' });
  }
}

async function getJourneyFlowHandler(req, res) {
  try {
    const { period, platform, device, personas, from, to } = req.query;
    const customRange = from && to ? { from, to } : null;
    const personaList = personas ? personas.split(',').filter(Boolean) : [];

    const data = await getJourneyFlow({
      period: period || '30d',
      customRange,
      personas: personaList,
      platform: platform || 'combined',
      device: device || null,
    });

    res.json(data);
  } catch (err) {
    console.error('[journey] flow failed', err);
    res.status(500).json({ error: 'Failed to compute journey flow' });
  }
}

module.exports = { getTopPathsHandler, getPathDetailHandler, getJourneyFlowHandler };