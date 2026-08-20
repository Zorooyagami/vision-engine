// server/controllers/recordController.js
const { decompressSync, strFromU8 } = require('fflate')
const Session = require('../models/Session')

async function getSessionReplay(req, res) {
  try {
    const { sessionId } = req.params
    const session = await Session.findOne({ sessionId })

    if (!session || session.chunks.length === 0) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // chunks are already in insertion order (mongoose $push preserves array order)
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

module.exports = { getSessionReplay }