const { listSessions, listRecordedUsers } = require('../services/sessionReplay');

function replayOptions(req) {
  const { period, personas, search, from, to } = req.query;
  return {
    projectId: req.projectId,
    period: period || '30d',
    customRange: from && to ? { from, to } : null,
    personas: personas ? personas.split(',').filter(Boolean) : [],
    search: search || '',
  };
}

async function getSessions(req, res) {
  try {
    const sessions = await listSessions({
      ...replayOptions(req),
      userId: req.query.userId || null,
    });
    res.json({ sessions });
  } catch (err) {
    console.error('[record/sessions] failed', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
}

async function getRecordedUsers(req, res) {
  try {
    const users = await listRecordedUsers(replayOptions(req));
    res.json({ users });
  } catch (err) {
    console.error('[record/recorded-users] failed', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
}

module.exports = { getSessions, getRecordedUsers };
