const { getPersonaLeaderboard } = require('../services/personaLeaderboard');

async function getLeaderboard(req, res) {
  try {
    const { period, platform, device, from, to } = req.query;
    const rows = await getPersonaLeaderboard({
      projectId: req.projectId,
      period: period || '30d',
      customRange: from && to ? { from, to } : null,
      platform: platform || 'combined',
      device: device || null,
    });
    res.json({ rows });
  } catch (err) {
    console.error('[persona-leaderboard] failed', err);
    res.status(500).json({ error: 'Failed to compute leaderboard' });
  }
}

module.exports = { getLeaderboard };
