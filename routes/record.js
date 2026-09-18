// server/routes/record.js
const express = require('express')
const { decompressSync, strFromU8 } = require('fflate')
const { getSessions, getRecordedUsers } = require('../controllers/sessionReplayController');

const Session = require('../models/Session')
const {
  ingestSession,
  getSessionReplay,
  listRecordedUsers,
  listUserSessions,
} = require('../controllers/recordController')

const router = express.Router()

// server/routes/record.js — full ordering, top to bottom matters
router.post('/ingest', express.raw({ type: '*/*', limit: '2mb' }), ingestSession)
router.get('/recorded-users', getRecordedUsers)   // new — top-level grouped list
router.get('/sessions', getSessions)              // flat list, now accepts ?userId=
router.get('/users', listRecordedUsers)           // old endpoint — can remove if unused elsewhere
router.get('/users/:userId/sessions', listUserSessions) // old endpoint — can remove if unused elsewhere
router.get('/:sessionId', getSessionReplay)       // catch-all — MUST stay last
module.exports = router