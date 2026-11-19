'use strict';
// Tiny, immutable analytics DSL. Never accept Mongo operators, paths, or
// expressions from users or the LLM. Only values are supplied by the planner.
const { error } = require('./catalog');
const MEASURES = ['count_events', 'distinct_users', 'count_sessions', 'sum_purchase_total', 'first_seen', 'last_seen'];
const GROUPS = ['none', 'day', 'hour_of_day', 'event', 'device', 'source', 'user', 'product'];
const BUILT_INS = ['page_view', 'purchase', 'product_view', 'view_item', 'add_to_cart', 'remove_from_cart', 'cart_remove', 'remove_cart_item', 'checkout_start', 'view_cart', 'sign_up'];
function validateQuerySpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw error('Invalid aggregation spec');
  if (Object.keys(raw).some(key => !['measure', 'groupBy', 'eventName'].includes(key))) throw error('Unknown aggregation field');
  if (!MEASURES.includes(raw.measure) || !GROUPS.includes(raw.groupBy)) throw error('Unsupported measure or dimension');
  if (raw.eventName != null && (typeof raw.eventName !== 'string' || raw.eventName.length > 100 || !/^[\w .:-]+$/.test(raw.eventName))) throw error('Invalid event name');
  if (['first_seen','last_seen'].includes(raw.measure) && raw.groupBy !== 'user') throw error('First and last seen require per-user grouping');
  if (raw.groupBy === 'product' && raw.measure !== 'count_events') throw error('Product grouping currently supports only event counts');
  if (raw.measure === 'sum_purchase_total' && raw.eventName && raw.eventName !== 'purchase') throw error('Revenue can only use purchase events');
  return Object.freeze({ measure: raw.measure, groupBy: raw.groupBy, eventName: raw.eventName || null });
}
function buildPipeline(spec, scope, knownEvents, { limit = 10, sort = 'desc', internalEdge = false } = {}) {
  spec = validateQuerySpec(spec);
  if (spec.eventName === 'cart_removals') { /* server-defined event family */ }
  else if (spec.eventName && !new Set([...BUILT_INS, ...knownEvents]).has(spec.eventName)) throw error('Event is not defined for this project');
  const match = { projectId: scope.projectId, timestamp: { $gte: scope.start, $lt: scope.end } };
  if (spec.eventName === 'cart_removals') match.event = { $in: ['remove_from_cart','cart_remove','remove_cart_item'] };
  else if (spec.eventName) match.event = spec.eventName;
  if (spec.measure === 'sum_purchase_total') match.event = 'purchase';
  if (spec.measure === 'sum_purchase_total' && spec.groupBy === 'user') match.userId = { $type: 'string', $ne: '' };
  // Filter only fields whose semantics can be preserved at event level.
  if (scope.devices?.length) match['deviceInfo.deviceType'] = { $in: scope.devices };
  if (scope.platform === 'web') match['deviceInfo.deviceType'] = 'Desktop';
  if (scope.platform === 'app') match['deviceInfo.deviceType'] = { $in: ['Mobile', 'Tablet'] };
  const group = ({ none: null, day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: scope.timezone } }, hour_of_day: { $hour: { date: '$timestamp', timezone: scope.timezone } }, event: '$event', device: { $ifNull: ['$deviceInfo.deviceType', 'Unknown'] }, source: { $ifNull: ['$trafficSource', 'Unknown'] }, user: '$userId', product: { $ifNull: ['$properties.productId', { $ifNull: ['$properties.id', { $ifNull: ['$properties.product.productId', '$properties.product.id'] }] }] } })[spec.groupBy];
  const pipeline = [{ $match: match }];
  let value = { $sum: 1 };
  if (['first_seen','last_seen'].includes(spec.measure)) {
    pipeline.push({ $match: { userId: { $type: 'string', $ne: '' } } });
    pipeline.push({ $project: { userId: 1, timestamp: 1 } });
    pipeline.push({ $group: { _id: '$userId', value: spec.measure === 'first_seen' ? { $min: '$timestamp' } : { $max: '$timestamp' } } });
  } else if (spec.measure === 'distinct_users') {
    // Index-narrowed grouping, no large $addToSet arrays.
    pipeline.push({ $match: { userId: { $type: 'string', $ne: '' } } });
    pipeline.push({ $group: { _id: { group, user: '$userId' } } });
    pipeline.push({ $group: { _id: '$_id.group', value: { $sum: 1 } } });
  } else if (spec.measure === 'count_sessions') {
    pipeline.push({ $match: { sessionId: { $type: 'string', $ne: '' } } });
    // Session dimension is based on the first scoped event, not arbitrary later events.
    pipeline.push({ $project: { sessionId: 1, event: 1, timestamp: 1, 'deviceInfo.deviceType': 1, trafficSource: 1 } });
    pipeline.push({ $sort: { timestamp: 1 } });
    pipeline.push({ $group: { _id: '$sessionId', first: { $first: { timestamp: '$timestamp', event: '$event', deviceInfo: '$deviceInfo', trafficSource: '$trafficSource' } } } });
    const sessionGroup = spec.groupBy === 'day' ? { $dateToString: { format: '%Y-%m-%d', date: '$first.timestamp', timezone: scope.timezone } } : spec.groupBy === 'hour_of_day' ? { $hour: { date: '$first.timestamp', timezone: scope.timezone } } : spec.groupBy === 'device' ? { $ifNull: ['$first.deviceInfo.deviceType', 'Unknown'] } : spec.groupBy === 'source' ? { $ifNull: ['$first.trafficSource', 'Unknown'] } : spec.groupBy === 'event' ? '$first.event' : null;
    pipeline.push({ $group: { _id: sessionGroup, value: { $sum: 1 } } });
  } else {
    if (spec.measure === 'sum_purchase_total') {
      pipeline.push({ $project: { timestamp: 1, event: 1, userId: 1, deviceInfo: { deviceType: 1 }, trafficSource: 1, amount: { $convert: { input: '$properties.total', to: 'double', onError: null, onNull: null } }, currency: { $ifNull: ['$properties.currency', process.env.DASHBOARD_CURRENCY || null] } } });
      pipeline.push({ $match: { amount: { $gte: 0 }, currency: { $type: 'string', $ne: '' } } });
      value = { $sum: '$amount' };
    } else if (spec.groupBy === 'product') {
      pipeline.push({ $project: { productId: group } });
      pipeline.push({ $match: { productId: { $ne: null } } });
    } else pipeline.push({ $project: { timestamp: 1, event: 1, 'deviceInfo.deviceType': 1, trafficSource: 1 } });
    pipeline.push({ $group: { _id: spec.measure === 'sum_purchase_total' ? { group, currency: '$currency' } : spec.groupBy === 'product' ? '$productId' : group, value } });
  }
  // A global top-N is computed in MongoDB; no unbounded result arrays in Node.
  pipeline.push(spec.groupBy === 'day' || spec.groupBy === 'hour_of_day' ? { $sort: { _id: 1 } } : { $sort: { value: sort === 'asc' ? 1 : -1, _id: 1 } });
  pipeline.push({ $limit: internalEdge ? 5001 : Math.min(365, Math.max(1, spec.groupBy === 'day' ? 365 : spec.groupBy === 'hour_of_day' ? 24 : limit)) });
  return pipeline;
}
module.exports = { validateQuerySpec, buildPipeline, BUILT_INS };
