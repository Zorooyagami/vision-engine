const router = require('express').Router();
const { requireProject } = require('../middleware/requireProject');
const { getSnapshot, readFilters } = require('../services/intelligence/snapshot');
const { answerQuestion } = require('../services/ask/service');
const { loadData } = require('../services/ask/data');
const { createGuard, authorize } = require('../services/ask/guard');
const guard = createGuard();
const { getHomeSummary } = require('../services/intelligence/homeSummary');
router.use(requireProject);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
function fail(res, error) {
  if (res.destroyed || res.headersSent) return;
  const status = error.status || 500;
  if (status === 429) res.set('Retry-After', '60');
  // No question text, model output or event payloads are logged.
  if (status >= 500) console.error('[intelligence] request failed', { status, code: error.code || 'internal' });
  res.status(status).json({ error: error.status ? error.message : (error.code === 50 || error.codeName === 'MaxTimeMSExpired' ? 'The analytics query timed out. Try a shorter range or check MongoDB indexes.' : 'Analytics service could not load this period. Check the backend logs and MongoDB connection.') });
}
router.get('/home-summary', async (req, res) => {
  try { res.json(await getHomeSummary(req)); } catch (error) { fail(res, error); }
});
router.get('/snapshot', async (req, res) => {
  try { res.json(await getSnapshot(req)); } catch (error) { fail(res, error); }
});
router.post('/ask', async (req, res) => {
  let release;
  try {
    authorize(req);
    release = guard.enter(req.projectId);
    const result = await answerQuestion(req.body, readFilters(req), { load: loadData, isCancelled: () => res.destroyed });
    if (!res.destroyed) res.json(result);
  } catch (error) { fail(res, error); }
  finally { release?.(); }
});
module.exports = router;
