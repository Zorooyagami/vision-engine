// server/controllers/recordController.js — ingest handler
const { decompressSync, strFromU8 } = require('fflate')
const Session = require('../models/Session')
async function ingestSession(req, res) {
  try {
    const compressed = new Uint8Array(req.body)
    const decompressed = decompressSync(compressed)
    const json = strFromU8(decompressed)
    const { sessionId, userId, page, events } = JSON.parse(json)

     console.log('[ingest] received:', {
      sessionId,
      userId,
      page,
      eventCount: events?.length,
    }) // temporary — remove once fixed

    if (!sessionId || !userId || !Array.isArray(events) || events.length === 0) {
      console.log('[ingest] rejected — missing:', {
        sessionId: !sessionId,
        userId: !userId,
        eventsArray: !Array.isArray(events),
        eventsEmpty: events?.length === 0,
      })
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

// server/controllers/recordController.js
async function listRecordedUsers(req, res) {
  try {
    // group by userId, get session count + most recent activity per user
    const users = await Session.aggregate([
      {
        $group: {
          _id: '$userId',
          sessionCount: { $sum: 1 },
          lastActivity: { $max: '$updatedAt' },
        },
      },
      { $sort: { lastActivity: -1 } },
    ])

    res.json(
      users.map((u) => ({
        userId: u._id,
        sessionCount: u.sessionCount,
        lastActivity: u.lastActivity,
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
    const sessions = await Session.find(
      { userId },
      { sessionId: 1, createdAt: 1, updatedAt: 1, chunks: 1 } // chunks needed just for page list below
    ).sort({ createdAt: -1 })

    res.json(
      sessions.map((s) => ({
        sessionId: s.sessionId,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        pages: [...new Set(s.chunks.map((c) => c.page))], // e.g. ["/", "/products", "/product/12"]
        chunkCount: s.chunks.length,
      }))
    )
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

// THIS is what was missing — without it, every destructured import in routes/record.js is undefined
module.exports = {
  ingestSession,
  getSessionReplay,
  listRecordedUsers,
  listUserSessions,
}