const { WINDOWS } = require('../services/insightWindows');
const { buildFactsForWindow } = require('../services/buildFacts');
const { synthesizeInsights } = require('../services/llmInsights');
const { getInsightsForWindow, getAllInsights } = require('../services/getInsights');
const InsightSnapshot = require('../models/InsightSnapshot');

// Generation is project-scoped. One project's long LLM call should not block
// another project's insight generation.
const projectsGenerating = new Set();

async function generateInsights(req, res) {
  const projectId = req.projectId;
  if (projectsGenerating.has(projectId)) {
    return res.status(409).json({ error: 'Generation already in progress' });
  }

  projectsGenerating.add(projectId);
  res.status(202).json({ status: 'started' });

  try {
    for (const { key, days } of WINDOWS) {
      const facts = await buildFactsForWindow(projectId, days);
      const insights = await synthesizeInsights(facts);
      await InsightSnapshot.findOneAndUpdate(
        { projectId, window: key },
        { projectId, window: key, generatedAt: new Date(), insights, rawFacts: facts },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      console.log(`[insights] project=${projectId} window=${key} done, ${insights.length} insights`);
    }
  } catch (err) {
    console.error(`[insights] project=${projectId} generation failed`, err);
  } finally {
    projectsGenerating.delete(projectId);
  }
}

async function getStatus(req, res) {
  res.json({ inProgress: projectsGenerating.has(req.projectId) });
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
