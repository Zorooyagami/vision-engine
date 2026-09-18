const { decompress, strFromU8 } = require('fflate') // only need the async version now
const Session = require('../models/Session')
const User = require('../models/User')
const zlib = require('zlib')

function decompressAsync(buf) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(buf, (err, result) => {
      if (err) return reject(err)
      resolve(new Uint8Array(result))
    })
  })
}
async function ingestSession(req, res) {
  try {
    console.log('[ingest] req.body type:', req.body?.constructor?.name, 'isBuffer:', Buffer.isBuffer(req.body), 'length:', req.body?.length)
    const compressed = new Uint8Array(req.body)
    const decompressed = await decompressAsync(compressed)
    const json = strFromU8(decompressed)
    const { sessionId, userId, page, events } = JSON.parse(json)

    if (!sessionId || !userId || !Array.isArray(events) || events.length === 0) {
      return res.sendStatus(400)
    }

    await Session.updateOne(
      { sessionId },
      {
        $push: {
          chunks: { page, data: Buffer.from(compressed), receivedAt: new Date() },
        },
        $setOnInsert: { sessionId, userId },
      },
      { upsert: true }
    )

    res.sendStatus(204)
  } catch (err) {
    console.error('[record/ingest] failed:', err.message)
    res.sendStatus(400)
  }
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
          from: 'users',
          localField: '_id',
          foreignField: 'userId',
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
        { sessionId: 1, createdAt: 1, updatedAt: 1, 'chunks.page': 1, 'chunks.receivedAt': 1 } // never pull chunks.data here
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

// ONE getSessionReplay only — this is the sole definition now
async function getSessionReplay(req, res) {
  try {
    const { sessionId } = req.params
    const session = await Session.findOne({ sessionId })

    if (!session || session.chunks.length === 0) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const eventsPerChunk = await Promise.all(
      session.chunks.map(async (chunk) => {
        const decompressed = await decompressAsync(new Uint8Array(chunk.data))
        const json = strFromU8(decompressed)
        return JSON.parse(json).events
      })
    )
    const events = eventsPerChunk.flat()

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