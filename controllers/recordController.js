const zlib = require('zlib');
const Session = require('../models/Session');
const User = require('../models/User');
const Project = require('../models/Project');

const ALLOW_LEGACY_USER_FALLBACK = process.env.ALLOW_LEGACY_USER_FALLBACK === 'true';

function decompressAsync(buffer) {
  return new Promise((resolve, reject) => {
    // The frontend SDK currently uses fflate.compressSync(), which produces a
    // zlib-wrapped payload. unzip also accepts gzip, so this remains tolerant
    // if the SDK compression format changes later.
    zlib.unzip(buffer, { maxOutputLength: 20 * 1024 * 1024 }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

async function ingestSession(req, res) {
  try {
    if (req.project?.settings?.sessionReplay === false) {
      return res.status(403).json({ error: 'Session replay is disabled for this project' });
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.sendStatus(400);

    const compressed = Buffer.from(req.body);
    const decompressed = await decompressAsync(compressed);
    const payload = JSON.parse(decompressed.toString('utf8'));
    const { sessionId, userId, page, events, projectId: payloadProjectId } = payload;

    if (payloadProjectId && payloadProjectId !== req.projectId) {
      return res.status(400).json({ error: 'Session projectId does not match request project' });
    }
    if (!sessionId || !userId || !Array.isArray(events) || !events.length) {
      return res.sendStatus(400);
    }

    const receivedAt = new Date();
    await Session.updateOne(
      { projectId: req.projectId, sessionId },
      {
        $push: {
          chunks: { page: page || '/', data: compressed, receivedAt },
        },
        $setOnInsert: { projectId: req.projectId, sessionId, userId },
      },
      { upsert: true }
    );

    await Project.updateOne(
      { projectId: req.projectId },
      { $max: { lastEventAt: receivedAt } }
    );

    res.sendStatus(204);
  } catch (err) {
    console.error('[record/ingest] failed:', err.message);
    res.status(400).json({ error: 'Invalid session replay payload' });
  }
}

function userScope(projectId, userId) {
  if (!ALLOW_LEGACY_USER_FALLBACK) return { projectId, userId };
  return {
    userId,
    $or: [{ projectId }, { projectId: null }, { projectId: { $exists: false } }],
  };
}

async function listRecordedUsers(req, res) {
  try {
    const users = await Session.aggregate([
      { $match: { projectId: req.projectId } },
      {
        $group: {
          _id: '$userId',
          sessionCount: { $sum: 1 },
          lastActivity: { $max: '$updatedAt' },
        },
      },
      { $sort: { lastActivity: -1 } },
    ]);

    const userQuery = {
      userId: { $in: users.map((row) => row._id) },
      ...(ALLOW_LEGACY_USER_FALLBACK
        ? {
            $or: [
              { projectId: req.projectId },
              { projectId: null },
              { projectId: { $exists: false } },
            ],
          }
        : { projectId: req.projectId }),
    };
    const details = await User.find(
      userQuery,
      { userId: 1, name: 1, email: 1, projectId: 1 }
    ).lean();
    const detailMap = new Map(details.map((user) => [user.userId, user]));

    res.json(users.map((row) => ({
      userId: row._id,
      sessionCount: row.sessionCount,
      lastActivity: row.lastActivity,
      name: detailMap.get(row._id)?.name || null,
      email: detailMap.get(row._id)?.email || null,
    })));
  } catch (err) {
    console.error('[record/users] failed:', err.message);
    res.status(500).json({ error: 'Failed to list users' });
  }
}

async function listUserSessions(req, res) {
  try {
    const { userId } = req.params;
    const [sessions, userDetails] = await Promise.all([
      Session.find(
        { projectId: req.projectId, userId },
        { sessionId: 1, createdAt: 1, updatedAt: 1, 'chunks.page': 1, 'chunks.receivedAt': 1 }
      ).sort({ createdAt: -1 }).lean(),
      User.findOne(userScope(req.projectId, userId), { name: 1, email: 1 }).lean(),
    ]);

    res.json({
      userId,
      name: userDetails?.name || null,
      email: userDetails?.email || null,
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        pages: [...new Set((session.chunks || []).map((chunk) => chunk.page).filter(Boolean))],
        chunkCount: session.chunks?.length || 0,
      })),
    });
  } catch (err) {
    console.error('[record/user-sessions] failed:', err.message);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
}

async function getSessionReplay(req, res) {
  try {
    const session = await Session.findOne({
      projectId: req.projectId,
      sessionId: req.params.sessionId,
    }).lean()

    if (!session || !session.chunks?.length) {
      return res.status(404).json({
        error: 'Session not found',
      })
    }

    const eventsPerChunk = await Promise.all(
      session.chunks.map(
        async (chunk, index) => {
          try {
            /*
             * Mongo/Mongoose should normally give us a Buffer,
             * but normalize it defensively.
             */
            const compressed = Buffer.isBuffer(
              chunk.data
            )
              ? chunk.data
              : Buffer.from(
                  chunk.data?.buffer ||
                    chunk.data
                )

            const decompressed =
              await decompressAsync(
                compressed
              )

            /*
             * decompressAsync() now returns a Node Buffer,
             * so use Buffer.toString() instead of
             * fflate's strFromU8().
             */
            const payload =
              JSON.parse(
                decompressed.toString(
                  'utf8'
                )
              )

            return Array.isArray(
              payload.events
            )
              ? payload.events
              : []
          } catch (err) {
            console.error(
              `[record/replay] failed to decode chunk ${index}:`,
              err
            )

            throw err
          }
        }
      )
    )

    const events = eventsPerChunk
      .flat()
      .sort(
        (a, b) =>
          (a.timestamp || 0) -
          (b.timestamp || 0)
      )

    res.json({
      sessionId:
        session.sessionId,

      eventCount:
        events.length,

      createdAt:
        session.createdAt,

      events,
    })
  } catch (err) {
    console.error(
      '[record/replay] failed:',
      err
    )

    res.status(500).json({
      error:
        'Failed to reassemble session',
    })
  }
}

module.exports = { ingestSession, getSessionReplay, listRecordedUsers, listUserSessions };
