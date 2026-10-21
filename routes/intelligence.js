const router = require('express').Router();
const { requireProject } = require('../middleware/requireProject');
const { getSnapshot, readFilters } = require('../services/intelligence/snapshot');
const { answerQuestion } = require('../services/ask/service');
const { loadData } = require('../services/ask/data');
const { createGuard, authorize } = require('../services/ask/guard');
const guard = createGuard();
router.use(requireProject);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
function fail(res, error) {
  if (res.destroyed || res.headersSent) return;
  const status = error.status || 500;
  if (status === 429) res.set('Retry-After', '60');
  // No question text, model output or event payloads are logged.
  if (status >= 500) console.error('[intelligence] request failed', { status, code: error.code || 'internal' });
  res.status(status).json({ error: error.status ? error.message : 'Analysis could not complete. Retry or narrow the reporting period.' });
}
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
