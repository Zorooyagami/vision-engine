const express = require("express");
const router = express.Router();
const { funnel, personas, getEventBreakdown, getCartAbandonmentFunnel, getAbandonedSessions, getPageViews, getJourneyCounts, getExitEvents, getExitPages, getUserSegments } = require("../controllers/statsController");
// GET /api/stats/funnel
router.get("/funnel", funnel);

router.get("/personas", personas);
// server/routes/analytics.js

router.get('/abandonment/funnel', getCartAbandonmentFunnel)
router.get('/abandonment/sessions', getAbandonedSessions)
// server/routes/analytics.js 
router.get('/events/breakdown', getEventBreakdown) // GET /api/analytics/events/breakdown
router.get('/events/page-views', getPageViews)
router.get('/events/journey-counts', getJourneyCounts)
router.get('/events/exit-events', getExitEvents)
router.get('/events/exit-pages', getExitPages)
router.get('/events/personas', getUserSegments)


// More endpoints will be added here as we build them:
// router.get("/segments", segments);
// router.get("/anomalies", anomalies);
// router.get("/insight-summary", insightSummary);

module.exports = router;
