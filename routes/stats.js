const express = require('express');
const router = express.Router();
const { requireProject } = require('../middleware/requireProject');
const {
  funnel,
  personas,
  getEventBreakdown,
  getCartAbandonmentFunnel,
  getAbandonedSessions,
  getPageViews,
  getJourneyCounts,
  getExitEvents,
  getExitPages,
  getUserSegments,
} = require('../controllers/statsController');

router.use(requireProject);
router.get('/funnel', funnel);
router.get('/personas', personas);
router.get('/abandonment/funnel', getCartAbandonmentFunnel);
router.get('/abandonment/sessions', getAbandonedSessions);
router.get('/events/breakdown', getEventBreakdown);
router.get('/events/page-views', getPageViews);
router.get('/events/journey-counts', getJourneyCounts);
router.get('/events/exit-events', getExitEvents);
router.get('/events/exit-pages', getExitPages);
router.get('/events/personas', getUserSegments);

module.exports = router;
