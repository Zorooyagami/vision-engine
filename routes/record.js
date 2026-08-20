// server/routes/record.js
const express = require('express')
const { decompressSync, strFromU8 } = require('fflate')
const Session = require('../models/Session')
const { getSessionReplay } = require('../controllers/recordController')

const router = express.Router()

router.post(
  '/ingest',
  express.raw({ type: '*/*', limit: '2mb' }),
  async (req, res) => {
    try {
      const compressed = new Uint8Array(req.body)
      const decompressed = decompressSync(compressed)
      const json = strFromU8(decompressed)
      const { sessionId, page, events } = JSON.parse(json)

      if (!sessionId || !Array.isArray(events) || events.length === 0) {
        return res.sendStatus(400)
      }

      await Session.updateOne(
        { sessionId },
        {
          $push: {
            chunks: {
              page,
              data: Buffer.from(compressed),
              receivedAt: new Date(),
            },
          },
          $setOnInsert: { sessionId },
        },
        { upsert: true }
      )

      res.sendStatus(204)
    } catch (err) {
      console.error('[record/ingest] failed:', err.message)
      res.sendStatus(400)
    }
  }
)

router.get('/:sessionId', getSessionReplay)

module.exports = router