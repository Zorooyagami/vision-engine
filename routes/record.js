const express = require('express');
const { getSessions, getRecordedUsers } = require('../controllers/sessionReplayController');
const {
  ingestSession,
  getSessionReplay,
  listRecordedUsers,
  listUserSessions,
} = require('../controllers/recordController');
const { requireProject } = require('../middleware/requireProject');
const { checkOrigin } = require('../middleware/checkOrigin');

const router = express.Router();

// rrweb payload is binary, so projectId must be sent via X-Project-Id or the
// query string (query is useful for sendBeacon, which cannot set custom headers).
router.post(
  '/ingest',
  requireProject,
  checkOrigin,
  express.raw({ type: '*/*', limit: '2mb' }),
  ingestSession
);

router.get('/recorded-users', requireProject, getRecordedUsers);
router.get('/sessions', requireProject, getSessions);
router.get('/users', requireProject, listRecordedUsers);
router.get('/users/:userId/sessions', requireProject, listUserSessions);
router.get('/:sessionId', requireProject, getSessionReplay); // catch-all MUST stay last

module.exports = router;
