// routes/events.js
const express = require('express');
const router = express.Router();
const {
  ingestEvents,
  getRecentEvents,
  getEventSummary,
  getPageHeatmaps,
  getSdkConfig,
} = require('../controllers/eventsController');
const { requireProject } = require('../middleware/requireProject');
const { checkOrigin } = require('../middleware/checkOrigin');

// Public SDK ingestion: project + browser origin must both validate.
router.post('/', requireProject, checkOrigin, ingestEvents);

// Public SDK config (dashboard-defined events). Same project + origin gate as ingestion.
router.get('/config', requireProject, checkOrigin, getSdkConfig);

// Dashboard/debug reads: project-scoped, but dashboard origin is controlled by
// server CORS rather than the tracked site's allowedOrigins.
router.get('/recent', requireProject, getRecentEvents);
router.get('/summary', requireProject, getEventSummary);
router.get('/heatmaps/:pageId', requireProject, getPageHeatmaps);

const snapshots = require('../controllers/heatmapSnapshots');
router.post('/heatmap-snapshots', requireProject, checkOrigin, snapshots.upload);
router.get('/heatmap-snapshots', requireProject, snapshots.list);
router.get('/heatmap-snapshots/:key', requireProject, snapshots.image);

module.exports = router;
