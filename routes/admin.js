// routes/admin.js
const router = require('express').Router();
const { generateInsights, getStatus, getInsights } = require('../controllers/insightsController');
// routes/admin.js — add this line among your existing routes
const { getTrend } = require('../controllers/revenueTrendController');
const { getFunnelData } = require('../controllers/funnelController');
// routes/admin.js — add
const { getTopPathsHandler, getPathDetailHandler, getJourneyFlowHandler } = require('../controllers/journeyController');
const { getEvents, patchEventStatus, postEvent, getEventDetailHandler } = require('../controllers/eventsControllerNew');

// routes/admin.js — add
const { getBreakdown, getStacked } = require('../controllers/revenueByPersonaController');
const { getLeaderboard } = require('../controllers/personaLeaderboardController');
const {
  createProjectHandler,
  listProjectsHandler,
  getProjectHandler,
  updateProjectHandler,
  deleteProjectHandler,
} = require(
  '../controllers/projectController')
const { requireProject } = require('../middleware/requireProject');
const { getOverview } = require('../controllers/personaOverviewController');
const { getPersonaOverview } = require('../controllers/personaExplorerController');

/* =========================
   PROJECTS
========================= */

router.post(
  '/projects',
  createProjectHandler
)

router.get(
  '/projects',
  listProjectsHandler
)

router.get(
  '/projects/:projectId',
  getProjectHandler
)

router.patch(
  '/projects/:projectId',
  updateProjectHandler
)

router.delete(
  '/projects/:projectId',
  deleteProjectHandler
)

router.use(requireProject); // everything registered below this line requires a valid projectId

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
router.get('/revenue/breakdown', getBreakdown);
router.get('/revenue/stacked', getStacked);
router.get('/persona-leaderboard', getLeaderboard);


router.get('/personas/overview', getPersonaOverview);

module.exports = router;