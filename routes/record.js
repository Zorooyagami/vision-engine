// server/routes/record.js
const express = require('express')
const { decompressSync, strFromU8 } = require('fflate')
const Session = require('../models/Session')
const {
  ingestSession,
  getSessionReplay,
  listRecordedUsers,
  listUserSessions,
} = require('../controllers/recordController')

const router = express.Router()

router.post('/ingest', express.raw({ type: '*/*', limit: '2mb' }), ingestSession)
router.get('/users', listRecordedUsers)                 // GET /api/record/users
router.get('/users/:userId/sessions', listUserSessions) // GET /api/record/users/:userId/sessions
router.get('/:sessionId', getSessionReplay)              // existing — keep this LAST, it's a catch-all pattern


module.exports = router