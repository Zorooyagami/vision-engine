const { WINDOWS } = require('../services/insightWindows');
const { buildFactsForWindow } = require('../services/buildFacts');
const { synthesizeInsights } = require('../services/llmInsights');
const { getInsightsForWindow, getAllInsights } = require('../services/getInsights');
const InsightSnapshot = require('../models/InsightSnapshot');

// Generation is project and window scoped. A failure is visible to the dashboard.
const jobs = new Map();
function jobKey(projectId, window) { return `${projectId}:${window}` }
async function generateInsights(req, res) {
  const projectId = req.projectId;
  const window = typeof req.body?.window === 'string' ? req.body.window : '30d';
  const selected = WINDOWS.find(w => w.key === window);
  if (!selected) return res.status(400).json({ error: 'Unsupported insight window' });
  const key = jobKey(projectId, window);
  if (jobs.get(key)?.inProgress) return res.status(409).json({ status: 'running', window });
  jobs.set(key, { inProgress: true, error: null, window });
  res.status(202).json({ status: 'started', window });
  try {
    const facts = await buildFactsForWindow(projectId, selected.days);
    const result = await synthesizeInsights(facts);
    await InsightSnapshot.findOneAndUpdate({ projectId, window },
      { projectId, window, generatedAt: new Date(), insights: result.insights, mode: result.mode, notice: result.notice || null, rawFacts: facts },
      { upsert: true, new: true, setDefaultsOnInsert: true });
    jobs.set(key, { inProgress: false, error: null, window, mode: result.mode, count: result.insights.length });
    console.log(`[insights] project=${projectId} window=${window} completed, count=${result.insights.length}, mode=${result.mode}`);
  } catch (error) {
    console.error(`[insights] project=${projectId} window=${window} generation failed:`, error);
    jobs.set(key, { inProgress: false, error: 'Insight generation failed. Check server logs and MongoDB connectivity.', window });
  }
}
async function getStatus(req, res) {
  const window = typeof req.query.window === 'string' ? req.query.window : '30d';
  if (!WINDOWS.some(w => w.key === window)) return res.status(400).json({ error: 'Unsupported insight window' });
  res.json(jobs.get(jobKey(req.projectId, window)) || { inProgress: false, window, error: null });
}

async function getInsights(req, res) {
  try {
    const { window } = req.query;
    if (!window) return res.json(await getAllInsights(req.projectId));
    const snapshot = await getInsightsForWindow(req.projectId, window);
    if (!snapshot) return res.status(404).json({ error: 'No insights generated yet for this window' });
    res.json(snapshot);
  } catch (err) {
    console.error('[insights] fetch failed', err);
    res.status(500).json({ error: 'Failed to load insights' });
  }
}

module.exports = { generateInsights, getStatus, getInsights };
