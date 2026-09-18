// controllers/insightsController.js
const { WINDOWS } = require('../services/insightWindows');
const { buildFactsForWindow } = require('../services/buildFacts');
const { synthesizeInsights } = require('../services/llmInsights');
const { getInsightsForWindow, getAllInsights } = require('../services/getInsights');
const InsightSnapshot = require('../models/InsightSnapshot');

let generationInProgress = false;

async function generateInsights(req, res) {
  if (generationInProgress) {
    return res.status(409).json({ error: 'Generation already in progress' });
  }
  generationInProgress = true;
  res.status(202).json({ status: 'started' });

  try {
    for (const { key, days } of WINDOWS) {
      const facts = await buildFactsForWindow(days);
      const insights = await synthesizeInsights(facts);

      await InsightSnapshot.findOneAndUpdate(
        { window: key },
        { window: key, generatedAt: new Date(), insights, rawFacts: facts },
        { upsert: true }
      );
      console.log(`[insights] window=${key} done, ${insights.length} insights`);
    }
  } catch (err) {
    console.error('[insights] generation failed', err);
  } finally {
    generationInProgress = false;
  }
}

async function getStatus(req, res) {
  res.json({ inProgress: generationInProgress });
}

async function getInsights(req, res) {
  const { window } = req.query;

  if (!window) {
    const all = await getAllInsights();
    return res.json(all);
  }

  const snapshot = await getInsightsForWindow(window);
  if (!snapshot) return res.status(404).json({ error: 'No insights generated yet for this window' });
  res.json(snapshot);
}

module.exports = { generateInsights, getStatus, getInsights };