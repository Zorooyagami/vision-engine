// controllers/sessionReplayController.js
const { listSessions, listRecordedUsers } = require('../services/sessionReplay');

async function getSessions(req, res) {
  try {
    const { period, personas, search, userId, from, to } = req.query;
    const customRange = from && to ? { from, to } : null;
    const personaList = personas ? personas.split(',').filter(Boolean) : [];

    const sessions = await listSessions({
      period: period || '30d',
      customRange,
      personas: personaList,
      search: search || '',
      userId: userId || null,
    });

    res.json({ sessions });
  } catch (err) {
    console.error('[record/sessions] failed', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
}

async function getRecordedUsers(req, res) {
  try {
    const { period, personas, search, from, to } = req.query;
    const customRange = from && to ? { from, to } : null;
    const personaList = personas ? personas.split(',').filter(Boolean) : [];

    const users = await listRecordedUsers({
      period: period || '30d',
      customRange,
      personas: personaList,
      search: search || '',
    });

    res.json({ users });
  } catch (err) {
    console.error('[record/recorded-users] failed', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
}

module.exports = { getSessions, getRecordedUsers };