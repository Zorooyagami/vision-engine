const {
  getPersonaExplorerOverview,
} = require('../services/personaExplorer');

async function getPersonaOverview(req, res) {
  try {
    const {
      period,
      platform,
      device,
      from,
      to,
    } = req.query;

    const data = await getPersonaExplorerOverview({
      // requireProject middleware resolves the active project from the
      // X-Project-Id header and places it on req.projectId.
      projectId: req.projectId,
      period: period || '30d',
      customRange: from && to ? { from, to } : null,
      platform: platform || 'combined',
      device: device || null,
    });

    res.json(data);
  } catch (err) {
    console.error('[personas/overview] failed', err);
    res.status(500).json({
      error: 'Failed to compute persona overview',
    });
  }
}

module.exports = {
  getPersonaOverview,
};
