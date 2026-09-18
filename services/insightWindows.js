// services/insightWindows.js
const WINDOWS = [
  { key: '1d', days: 1 },
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: '180d', days: 180 },
];

function getRange(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  // previous equivalent period, for delta comparisons
  const prevEnd = new Date(start);
  const prevStart = new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end, prevStart, prevEnd };
}

module.exports = { WINDOWS, getRange };