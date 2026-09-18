// routes/admin.js
const router = require('express').Router();
const { generateInsights, getStatus, getInsights } = require('../controllers/insightsController');
// routes/admin.js — add this line among your existing routes
const { getTrend } = require('../controllers/revenueTrendController');
const { getFunnelData } = require('../controllers/funnelController');
// routes/admin.js — add
const { getTopPathsHandler, getPathDetailHandler, getJourneyFlowHandler } = require('../controllers/journeyController');
const { getEvents, patchEventStatus, postEvent, getEventDetailHandler } = require('../controllers/eventsControllerNew');


router.get('/events', getEvents);
router.patch('/events/:name/status', patchEventStatus);
router.post('/events', postEvent);
router.get('/events/:name/detail', getEventDetailHandler);

router.get('/journeys/top-paths', getTopPathsHandler);
router.get('/journeys/path-detail', getPathDetailHandler);
router.post('/insights/generate', generateInsights);
router.get('/journeys/flow', getJourneyFlowHandler);
router.get('/insights/status', getStatus);
router.get('/insights', getInsights); // ?window=1d|7d|30d|90d|180d

router.get('/revenue-trend', getTrend);
router.get('/funnel', getFunnelData);
module.exports = router;