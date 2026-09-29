const express = require('express');
const router = express.Router();
const {
  ingestEvents,
  getRecentEvents,
  getEventSummary,
  getPageHeatmaps,
} = require('../controllers/eventsController');
const { requireProject } = require('../middleware/requireProject');
const { checkOrigin } = require('../middleware/checkOrigin');

// Public SDK ingestion: project + browser origin must both validate.
router.post('/', requireProject, checkOrigin, ingestEvents);

// Dashboard/debug reads: project-scoped, but dashboard origin is controlled by
// server CORS rather than the tracked site's allowedOrigins.
router.get('/recent', requireProject, getRecentEvents);
router.get('/summary', requireProject, getEventSummary);
router.get('/heatmaps/:pageId', requireProject, getPageHeatmaps);

module.exports = router;
