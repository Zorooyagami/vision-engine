const Event = require('../../models/Event');
const { error } = require('./catalog');
const { getLoyalUserIds } = require('../aggregations');
const QUERY_TIMEOUT = Math.min(120000, Math.max(15000, Number(process.env.INTELLIGENCE_QUERY_TIMEOUT_MS) || 45000));
async function loadData(scope, comparison = true, { includeLoyal = true, signal = null, ordered = false } = {}) {
  const cap = Math.floor(Math.min(100000, Math.max(1000, Number(process.env.ASK_MAX_EVENTS) || 30000)));
  const windows = [{ start: scope.start, end: scope.end }];
  if (comparison) windows.push({ start: scope.previousStart, end: scope.previousEnd });
  const projectId = scope.projectId;
  // All executable queries are server-owned and always project scoped.
  const eventPromise = !ordered ? Event.find({ projectId, $or: windows.map(w => ({ timestamp: { $gte: w.start, $lt: w.end } })) })
    .select('event sessionId userId timestamp deviceInfo.deviceType deviceInfo.geo deviceInfo.city deviceInfo.country browser trafficSource path properties.total properties.currency properties.orderId properties.products properties.productId properties.productName properties.productQuantity properties.productPrice')
    .sort({ timestamp: 1 }).limit(cap + 1).maxTimeMS(QUERY_TIMEOUT).lean()
    : Event.aggregate(require('./sessionLoader').buildSessionPipeline(scope, windows, cap)).allowDiskUse(true).option({ maxTimeMS: QUERY_TIMEOUT, ...(signal ? { signal } : {}) }).exec();
  if (signal && !ordered) eventPromise.setOptions({ signal });
  const loyalPromise = includeLoyal ? getLoyalUserIds(projectId) : Promise.resolve(new Set());
  if (signal?.aborted) throw error('Request cancelled', 499);
  const [events, loyal] = await Promise.all([eventPromise, loyalPromise]);
  if (events.length > cap || loyal.size > cap) throw error(`This question exceeds the ${cap.toLocaleString('en-GB')} record analysis limit. Narrow the dates and retry.`, 413);
  const within = (e, w) => +new Date(e.timestamp) >= +w.start && +new Date(e.timestamp) < +w.end;
  return { current: events.filter(e => within(e, windows[0])), previous: comparison ? events.filter(e => within(e, windows[1])) : [], loyal };
}
module.exports = { loadData };
