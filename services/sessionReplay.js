//services/sessionReplay.js
const Session = require('../models/Session');
const Event = require('../models/Event');
const { resolveDateRange, getPersonaUserIds } = require('./filterHelpers');
const { sessionActiveMs } = require('./replayTimeline');

const ALLOW_LEGACY_USER_FALLBACK = process.env.ALLOW_LEGACY_USER_FALLBACK === 'true';

function computeDuration(chunks) {
  if (!chunks?.length) return null;
  // Preferred: active time (idle gaps removed), as stored at ingest.
  const activeMs = sessionActiveMs(chunks);
  if (activeMs !== null) {
    const secs = Math.max(0, Math.round(activeMs / 1000));
    return { totalSecs: secs, label: `${Math.floor(secs / 60)}m ${secs % 60}s` };
  }
  // Older recordings: wall-clock span between uploads (can include idle time).
  const times = chunks
    .map((chunk) => new Date(chunk.receivedAt).getTime())
    .filter(Number.isFinite);
  if (!times.length) return null;
  const totalSecs = Math.max(0, Math.round((Math.max(...times) - Math.min(...times)) / 1000));
  return { totalSecs, label: `${Math.floor(totalSecs / 60)}m ${totalSecs % 60}s` };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function projectUserExpr(replayUserExpr, replayProjectExpr) {
  const conditions = [{ $eq: ['$userId', replayUserExpr] }];
  if (ALLOW_LEGACY_USER_FALLBACK) {
    conditions.push({
      $or: [
        { $eq: ['$projectId', replayProjectExpr] },
        { $eq: [{ $ifNull: ['$projectId', null] }, null] },
      ],
    });
  } else {
    conditions.push({ $eq: ['$projectId', replayProjectExpr] });
  }
  return { $and: conditions };
}

async function buildSessionMatch({
  projectId,
  period = '30d',
  customRange,
  personas = [],
  userId = null,
}) {
  if (!projectId) throw new Error('projectId is required');

  const { start, end } = resolveDateRange(period, customRange);
  const match = { projectId, createdAt: { $gte: start, $lt: end } };

  if (userId) {
    match.userId = userId;
  } else if (personas.length) {
    const personaFilter = await getPersonaUserIds(projectId, personas, start, end);
    const ids = [...(personaFilter?.ids || [])];

    // rrweb is currently recorded only for authenticated users. Guest replay
    // can be added later without changing the tenant-scoping model.
    match.userId = { $in: ids.length ? ids : ['__no_match__'] };
  }

  return match;
}

function userLookupStage() {
  return {
    $lookup: {
      from: 'users',
      let: { replayUserId: '$userId', replayProjectId: '$projectId' },
      pipeline: [
        {
          $match: {
            $expr: projectUserExpr('$$replayUserId', '$$replayProjectId'),
          },
        },
        { $project: { _id: 0, name: 1, email: 1 } },
        { $limit: 1 },
      ],
      as: 'userDetails',
    },
  };
}

async function listSessions({
  projectId,
  period = '30d',
  customRange,
  personas = [],
  search = '',
  userId = null,
}) {
  const match = await buildSessionMatch({ projectId, period, customRange, personas, userId });

  const pipeline = [
    { $match: match },
    // Never pull compressed rrweb chunk data for list views.
    {
      $project: {
        projectId: 1,
        sessionId: 1,
        userId: 1,
        createdAt: 1,
        updatedAt: 1,
        'chunks.page': 1,
        'chunks.receivedAt': 1,
        'chunks.spans': 1,
        'chunks.firstTs': 1,
        'chunks.lastTs': 1,
      },
    },
    userLookupStage(),
    { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
  ];

  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
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

  pipeline.push({ $sort: { createdAt: -1 } });
  const sessions = await Session.aggregate(pipeline);

  return sessions.map((session) => {
    const duration = computeDuration(session.chunks);
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      name: session.userDetails?.name || null,
      email: session.userDetails?.email || null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      duration: duration?.label || '—',
      durationSecs: duration?.totalSecs || 0,
      pages: [...new Set((session.chunks || []).map((chunk) => chunk.page).filter(Boolean))],
      chunkCount: session.chunks?.length || 0,
    };
  });
}


const LOCATION_FIELDS = [
  'deviceInfo.geo.city',
  'deviceInfo.city',
  'deviceInfo.geo.country',
  'deviceInfo.country',
];

/**
 * Latest known city/country per user, read from tracked events
 * (deviceInfo.geo.* first, then deviceInfo.city/country, the same
 * sources the live feed uses). Always project scoped.
 *
 * Returns Map<userId, { city, country }>. Never throws: a failed lookup
 * must not break the recorded-users list.
 */
async function lookupUserLocations({ projectId, userIds, period, customRange }) {
  const locations = new Map();
  if (!projectId || !userIds.length) return locations;

  try {
    const { start, end } = resolveDateRange(period, customRange);
    const rows = await Event.aggregate([
      {
        $match: {
          projectId,
          userId: { $in: userIds },
          timestamp: { $gte: start, $lt: end },
          $or: LOCATION_FIELDS.map((field) => ({ [field]: { $nin: [null, ''] } })),
        },
      },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$userId',
          city: { $first: { $ifNull: ['$deviceInfo.geo.city', '$deviceInfo.city'] } },
          country: { $first: { $ifNull: ['$deviceInfo.geo.country', '$deviceInfo.country'] } },
        },
      },
    ]).option({ maxTimeMS: 15000 });

    for (const row of rows) {
      locations.set(row._id, { city: row.city || null, country: row.country || null });
    }
  } catch (err) {
    console.error('[record/recorded-users] location lookup failed', err.message);
  }

  return locations;
}

async function listRecordedUsers({
  projectId,
  period = '30d',
  customRange,
  personas = [],
  search = '',
}) {
  const match = await buildSessionMatch({ projectId, period, customRange, personas });

  // Aggregate directly in Mongo rather than loading every session + every
  // chunk into Node and grouping in memory.
  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$userId',
        projectId: { $first: '$projectId' },
        sessionCount: { $sum: 1 },
        lastActivity: { $max: '$updatedAt' },
      },
    },
    { $set: { userId: '$_id' } },
    userLookupStage(),
    { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
  ];

  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
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

  pipeline.push(
    { $sort: { lastActivity: -1 } },
    {
      $project: {
        _id: 0,
        userId: 1,
        name: { $ifNull: ['$userDetails.name', null] },
        email: { $ifNull: ['$userDetails.email', null] },
        sessionCount: 1,
        lastActivity: 1,
      },
    }
  );

  const users = await Session.aggregate(pipeline);

  const locations = await lookupUserLocations({
    projectId,
    userIds: users.map((user) => user.userId).filter(Boolean),
    period,
    customRange,
  });

  return users.map((user) => ({
    ...user,
    city: locations.get(user.userId)?.city || null,
    country: locations.get(user.userId)?.country || null,
  }));
}

module.exports = { listSessions, listRecordedUsers, buildSessionMatch };
