const Event = require('../../models/Event');
const { error } = require('./catalog');
const { getLoyalUserIds } = require('../aggregations');
const QUERY_TIMEOUT = Math.min(120000, Math.max(15000, Number(process.env.INTELLIGENCE_QUERY_TIMEOUT_MS) || 45000));
async function loadData(scope, comparison = true, { includeLoyal = true } = {}) {
  const cap = Math.floor(Math.min(100000, Math.max(1000, Number(process.env.ASK_MAX_EVENTS) || 30000)));
  const windows = [{ start: scope.start, end: scope.end }];
  if (comparison) windows.push({ start: scope.previousStart, end: scope.previousEnd });
  const projectId = scope.projectId;
  // All executable queries are server-owned and always project scoped.
  const eventPromise = Event.find({ projectId, $or: windows.map(w => ({ timestamp: { $gte: w.start, $lt: w.end } })) })
    .select('event sessionId userId timestamp deviceInfo browser trafficSource path properties')
    .sort({ timestamp: 1, _id: 1 }).limit(cap + 1).maxTimeMS(QUERY_TIMEOUT).lean();
  const loyalPromise = includeLoyal ? getLoyalUserIds(projectId) : Promise.resolve(new Set());
  const [events, loyal] = await Promise.all([eventPromise, loyalPromise]);
  if (events.length > cap || loyal.size > cap) throw error(`This question exceeds the ${cap.toLocaleString('en-GB')} record analysis limit. Narrow the dates and retry.`, 413);
  const within = (e, w) => +new Date(e.timestamp) >= +w.start && +new Date(e.timestamp) < +w.end;
  return { current: events.filter(e => within(e, windows[0])), previous: comparison ? events.filter(e => within(e, windows[1])) : [], loyal };
}
module.exports = { loadData };
