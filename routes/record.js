const express = require('express')
const { getSessions, getRecordedUsers } = require('../controllers/sessionReplayController')
const {
  ingestSession,
  getSessionReplay,
  listRecordedUsers,
  listUserSessions,
} = require('../controllers/recordController')

const router = express.Router()

router.post('/ingest', express.raw({ type: '*/*', limit: '2mb' }), ingestSession)
router.get('/recorded-users', getRecordedUsers)
router.get('/sessions', getSessions)
router.get('/users', listRecordedUsers)
router.get('/users/:userId/sessions', listUserSessions)
router.get('/:sessionId', getSessionReplay) // catch-all — MUST stay last

module.exports = router