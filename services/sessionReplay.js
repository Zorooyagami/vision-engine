const Session = require('../models/Session');
const { resolveDateRange, getPersonaUserIds } = require('./filterHelpers');

function computeDuration(chunks) {
  if (!chunks?.length) return null;
  const times = chunks.map((c) => new Date(c.receivedAt).getTime());
  const spanMs = Math.max(...times) - Math.min(...times);
  const totalSecs = Math.round(spanMs / 1000);
  return { totalSecs, label: `${Math.floor(totalSecs / 60)}m ${totalSecs % 60}s` };
}

async function listSessions({ period = '30d', customRange, personas = [], search = '', userId = null }) {
  const { start, end } = resolveDateRange(period, customRange);
  const match = { createdAt: { $gte: start, $lt: end } };
  if (userId) match.userId = userId;

  if (!userId && personas.length) {
    const personaFilter = await getPersonaUserIds(personas, start, end);
    if (personaFilter) {
      const ids = [...personaFilter.ids];
      match.userId = { $in: ids.length ? ids : ['__no_match__'] };
    }
  }

  const pipeline = [
    { $match: match },
    // CRITICAL: strip chunk binary data at the database level — never let
    // raw compressed buffers leave Mongo for a list endpoint. This was the
    // missing piece causing event-loop blocking under concurrent ingest.
    {
      $project: {
        sessionId: 1,
        userId: 1,
        createdAt: 1,
        updatedAt: 1,
        'chunks.page': 1,
        'chunks.receivedAt': 1,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: 'userId',
        as: 'userDetails',
      },
    },
    { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
    { $sort: { createdAt: -1 } },
  ];

  if (search) {
    const re = new RegExp(search, 'i');
    pipeline.push({
      $match: {
        $or: [
          { userId: re },
          { 'userDetails.name': re },
          { 'userDetails.email': re },
        ],
      },
    });
  }

  const sessions = await Session.aggregate(pipeline);

  return sessions.map((s) => {
    const duration = computeDuration(s.chunks);
    const pages = [...new Set((s.chunks || []).map((c) => c.page).filter(Boolean))];
    return {
      sessionId: s.sessionId,
      userId: s.userId,
      name: s.userDetails?.name || null,
      email: s.userDetails?.email || null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      duration: duration?.label || '—',
      durationSecs: duration?.totalSecs || 0,
      pages,
      chunkCount: s.chunks?.length || 0,
    };
  });
}

async function listRecordedUsers({ period = '30d', customRange, personas = [], search = '' }) {
  const allSessions = await listSessions({ period, customRange, personas, search });

  const byUser = new Map();
  for (const s of allSessions) {
    if (!byUser.has(s.userId)) {
      byUser.set(s.userId, {
        userId: s.userId,
        name: s.name,
        email: s.email,
        sessionCount: 0,
        lastActivity: s.createdAt,
      });
    }
    const entry = byUser.get(s.userId);
    entry.sessionCount += 1;
    if (new Date(s.createdAt) > new Date(entry.lastActivity)) {
      entry.lastActivity = s.createdAt;
    }
  }

  return [...byUser.values()].sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
}

module.exports = { listSessions, listRecordedUsers };