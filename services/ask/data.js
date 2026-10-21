const Event = require('../../models/Event');
const { error } = require('./catalog');
const QUERY_TIMEOUT = 15000;
async function loadData(scope, comparison = true) {
  const cap = Math.floor(Math.min(100000, Math.max(1000, Number(process.env.ASK_MAX_EVENTS) || 30000)));
  const windows = [{ start: scope.start, end: scope.end }];
  if (comparison) windows.push({ start: scope.previousStart, end: scope.previousEnd });
  const projectId = scope.projectId;
  // All executable queries are server-owned and always project scoped.
  const eventPromise = Event.find({ projectId, $or: windows.map(w => ({ timestamp: { $gte: w.start, $lt: w.end } })) })
    .select('event sessionId userId timestamp deviceInfo.deviceType browser trafficSource path properties.total properties.currency')
    .sort({ timestamp: 1, _id: 1 }).limit(cap + 1).maxTimeMS(QUERY_TIMEOUT).lean();
  const loyalPromise = Event.aggregate([
    { $match: { projectId, event: 'purchase', userId: { $nin: [null, ''] } } },
    { $group: { _id: '$userId', count: { $sum: 1 } } },
    { $match: { count: { $gte: 2 } } }, { $project: { count: 0 } }, { $limit: cap + 1 },
  ]).option({ maxTimeMS: QUERY_TIMEOUT });
  const [events, loyalRows] = await Promise.all([eventPromise, loyalPromise]);
  if (events.length > cap || loyalRows.length > cap) throw error(`This question exceeds the ${cap.toLocaleString('en-GB')} record analysis limit. Narrow the dates and retry.`, 413);
  const within = (e, w) => +new Date(e.timestamp) >= +w.start && +new Date(e.timestamp) < +w.end;
  return { current: events.filter(e => within(e, windows[0])), previous: comparison ? events.filter(e => within(e, windows[1])) : [], loyal: new Set(loyalRows.map(x => String(x._id))) };
}
module.exports = { loadData };
