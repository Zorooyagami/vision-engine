const InsightSnapshot = require('../models/InsightSnapshot');
const { WINDOWS } = require('./insightWindows');

async function getInsightsForWindow(projectId, window) {
  const snapshot = await InsightSnapshot.findOne({ projectId, window }).lean();
  if (!snapshot) return null;
  return { generatedAt: snapshot.generatedAt, insights: snapshot.insights };
}

async function getAllInsights(projectId) {
  const snapshots = await InsightSnapshot.find({ projectId }).lean();
  const byWindow = {};
  for (const { key } of WINDOWS) {
    const snapshot = snapshots.find((row) => row.window === key);
    byWindow[key] = {
      generatedAt: snapshot?.generatedAt || null,
      insights: snapshot?.insights || [],
    };
  }
  return byWindow;
}

module.exports = { getInsightsForWindow, getAllInsights };
