const router = require('express').Router();
const { requireProject } = require('../middleware/requireProject');
const { getSnapshot, readFilters } = require('../services/intelligence/snapshot');
const { answerQuestion } = require('../services/ask/service');
const { loadData } = require('../services/ask/data');
const { createGuard, authorize } = require('../services/ask/guard');
const guard = createGuard();
const { cachedAnalytics } = require('../services/intelligence/requestCache');
const { getHomeSummary } = require('../services/intelligence/homeSummary');
router.use(requireProject);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
function fail(res, error) {
  if (res.destroyed || res.headersSent) return;
  const timeout = error.code === 50 || error.codeName === 'MaxTimeMSExpired' || error.name === 'MongoServerError' && /time limit/i.test(error.message || '');
  const memory = [292, 16819].includes(error.code) || /memory limit|sort exceeded/i.test(error.message || '');
  const connectivity = ['MongoServerSelectionError','MongoNetworkError'].includes(error.name);
  const status = error.status || (timeout ? 504 : connectivity ? 503 : 500);
  if (status === 429) res.set('Retry-After', '60');
  if (status >= 500) console.error('[intelligence] request failed', {
    route: res.req?.originalUrl?.split('?')[0], status,
    name: error.name, code: error.code || 'internal', codeName: error.codeName,
    reason: timeout ? 'mongo_timeout' : memory ? 'mongo_memory' : connectivity ? 'mongo_unavailable' : 'query_failure',
    mongoMessage: memory ? String(error.message || '').slice(0, 350) : undefined,
  });
  const message = error.status ? error.message
    : timeout ? 'Analytics query timed out. Check MongoDB indexes and query performance.'
    : memory ? 'Analytics query exceeded MongoDB memory limits. Check aggregation indexes and disk-use settings.'
    : connectivity ? 'Analytics database is temporarily unavailable. Please retry.'
    : 'Analytics service could not load this period. Check the backend logs and MongoDB connection.';
  res.status(status).json({ error: message });
}
router.get('/home-summary', async (req, res) => {
  try { res.json(await cachedAnalytics('home-summary', req, () => getHomeSummary(req), 30000)); } catch (error) { fail(res, error); }
});
router.get('/snapshot', async (req, res) => {
  try { res.json(await cachedAnalytics('snapshot', req, () => getSnapshot(req), 30000)); } catch (error) { fail(res, error); }
});
router.post('/ask', async (req, res) => {
  let release;
  try {
    authorize(req);
    release = guard.enter(req.projectId);
    const controller = new AbortController();
    const cancelled = () => controller.signal.aborted || res.destroyed;
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', onClose);
    try {
      const result = await answerQuestion(req.body, readFilters(req), { load: loadData, signal: controller.signal, isCancelled: cancelled });
      if (!cancelled()) res.json(result);
    } finally { res.off('close', onClose); }
  } catch (error) { fail(res, error); }
  finally { release?.(); }
});
module.exports = router;
