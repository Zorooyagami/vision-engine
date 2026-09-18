// services/getInsights.js
const InsightSnapshot = require('../models/InsightSnapshot');
const { WINDOWS } = require('./insightWindows');

async function getInsightsForWindow(window) {
  const snapshot = await InsightSnapshot.findOne({ window }).lean();
  if (!snapshot) return null;
  return {
    generatedAt: snapshot.generatedAt,
    insights: snapshot.insights,
  };
}

async function getAllInsights() {
  const snapshots = await InsightSnapshot.find({}).lean();

  const byWindow = {};
  for (const { key } of WINDOWS) {
    const snap = snapshots.find((s) => s.window === key);
    byWindow[key] = {
      generatedAt: snap?.generatedAt || null,
      insights: snap?.insights || [],
    };
  }
  return byWindow;
}

module.exports = { getInsightsForWindow, getAllInsights };