const { decompressSync, strFromU8 } = require('fflate')
const Session = require('../models/Session')
const User = require('../models/User') // add this import

async function ingestSession(req, res) {
  // ...unchanged...
}

async function listRecordedUsers(req, res) {
  try {
    const users = await Session.aggregate([
      {
        $group: {
          _id: '$userId',
          sessionCount: { $sum: 1 },
          lastActivity: { $max: '$updatedAt' },
        },
      },
      {
        $lookup: {
          from: 'users',          // the actual Mongo collection name for the User model
          localField: '_id',      // Session's grouped userId (a string)
          foreignField: 'userId', // User.userId (also a string) — NOT _id/ObjectId
          as: 'userDetails',
        },
      },
      { $unwind: { path: '$userDetails', preserveNullAndEmptyArrays: true } },
      { $sort: { lastActivity: -1 } },
    ])

    res.json(
      users.map((u) => ({
        userId: u._id,
        sessionCount: u.sessionCount,
        lastActivity: u.lastActivity,
        name: u.userDetails?.name || null,
        email: u.userDetails?.email || null,
      }))
    )
  } catch (err) {
    console.error('[record/users] failed:', err.message)
    res.status(500).json({ error: 'Failed to list users' })
  }
}

async function listUserSessions(req, res) {
  try {
    const { userId } = req.params

    const [sessions, userDetails] = await Promise.all([
      Session.find(
        { userId },
        { sessionId: 1, createdAt: 1, updatedAt: 1, chunks: 1 }
      ).sort({ createdAt: -1 }),
      User.findOne({ userId }, { name: 1, email: 1 }).lean(),
    ])

    res.json({
      userId,
      name: userDetails?.name || null,
      email: userDetails?.email || null,
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        pages: [...new Set(s.chunks.map((c) => c.page))],
        chunkCount: s.chunks.length,
      })),
    })
  } catch (err) {
    console.error('[record/user-sessions] failed:', err.message)
    res.status(500).json({ error: 'Failed to list sessions' })
  }
}

async function getSessionReplay(req, res) {
  try {
    const { sessionId } = req.params
    const session = await Session.findOne({ sessionId })

    if (!session || session.chunks.length === 0) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const events = session.chunks.flatMap((chunk) => {
      const decompressed = decompressSync(new Uint8Array(chunk.data))
      const json = strFromU8(decompressed)
      const parsed = JSON.parse(json)
      return parsed.events
    })

    res.json({
      sessionId: session.sessionId,
      eventCount: events.length,
      createdAt: session.createdAt,
      events,
    })
  } catch (err) {
    console.error('[record/replay] failed:', err.message)
    res.status(500).json({ error: 'Failed to reassemble session' })
  }
}


module.exports = {
  ingestSession,
  getSessionReplay,
  listRecordedUsers,
  listUserSessions,
}