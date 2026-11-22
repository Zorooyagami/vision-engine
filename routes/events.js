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
const { responseCache } = require('../middleware/responseCache');

// Public SDK ingestion: project + browser origin must both validate.
router.post('/', requireProject, checkOrigin, ingestEvents);

// Public SDK config (dashboard-defined events). Same project + origin gate as ingestion.
router.get('/config', requireProject, checkOrigin, responseCache({ ttlMs: 30000 }), getSdkConfig);

// Dashboard/debug reads: project-scoped, but dashboard origin is controlled by
// server CORS rather than the tracked site's allowedOrigins.
router.get('/recent', requireProject, getRecentEvents);
router.get('/summary', requireProject, getEventSummary);
router.get('/heatmaps/:pageId', requireProject, responseCache({ ttlMs: 30000 }), getPageHeatmaps);

module.exports = router;
