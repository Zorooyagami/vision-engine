const Event = require('../../models/Event');
const { readReportingFilters } = require('../exploreFilters');
const { applyPlatformDeviceFilter } = require('../filterHelpers');

const PERCENT = (part, total) => total ? (100 * part / total).toFixed(1) : '0.0';
const format = value => Number(value || 0).toLocaleString('en-US');

// All facts are produced from the selected project's observed analytics events.
// The home tile shows a short preview; the full At a Glance page shows every supported fact.
function buildHomeFacts(r) {
  if (!r.sessions) return [];
  const facts = [
    { id: 'sessions', title: `${format(r.sessions)} tracked sessions`,
      text: `${format(r.events)} analytics events recorded during this reporting period.`, to: '/explore', tone: 'purple' },
  ];
  if (r.pageSessions) facts.push({ id: 'page-views', title: `${format(r.pageSessions)} sessions with page views`,
    text: `${format(r.pageViews)} page-view events across ${format(r.pageSessions)} distinct sessions.`, to: '/explore', tone: 'green' });
  if (r.productSessions) facts.push({ id: 'products', title: `${format(r.productSessions)} sessions viewed products`,
    text: `${PERCENT(r.productSessions, r.sessions)}% of tracked sessions recorded a product_view event.`, to: '/product-intelligence', tone: 'orange' });
  if (r.cartSessions) facts.push({ id: 'carts', title: `${format(r.cartSessions)} sessions added to cart`,
    text: `${format(r.cartEvents)} add_to_cart events; session counts are deduplicated.`, to: '/revenue-investigator', tone: 'purple' });
  if (r.checkoutSessions) facts.push({ id: 'checkout', title: `${format(r.checkoutSessions)} sessions started checkout`,
    text: `${PERCENT(r.checkoutSessions, r.sessions)}% of tracked sessions recorded checkout_start. This is not a sequential funnel.`, to: '/journey-comparison', tone: 'orange' });
  if (r.purchasingSessions) facts.push({ id: 'purchases', title: `${format(r.purchasingSessions)} sessions included purchase events`,
    text: `${format(r.purchaseEvents)} purchase events in ${format(r.purchasingSessions)} sessions. These do not verify payments.`, to: '/revenue-investigator', tone: 'green' });
  if (r.identifiedSessions) facts.push({ id: 'identified', title: `${format(r.identifiedSessions)} identified-user sessions`,
    text: `${PERCENT(r.identifiedSessions, r.sessions)}% of tracked sessions include a non-empty user ID.`, to: '/explore', tone: 'purple' });
  const guests = r.sessions - r.identifiedSessions;
  if (guests > 0) facts.push({ id: 'guest', title: `${format(guests)} sessions without an identified user`,
    text: 'The SDK did not attach an identified user ID to these sessions.', to: '/explore', tone: 'orange' });
  if (r.customEvents) facts.push({ id: 'other', title: `${format(r.customEvents)} other tracked events`,
    text: 'Other SDK or dashboard-defined event names observed in the selected period.', to: '/explore', tone: 'green' });
  return facts;
}

async function getHomeSummary(req) {
  const f = readReportingFilters(req);
  const match = {
    projectId: f.projectId,
    timestamp: { $gte: f.start, $lt: f.end },
    sessionId: { $type: 'string', $ne: '' },
  };
  applyPlatformDeviceFilter(match, f.platform, f.device);
  const is = event => ({ $eq: ['$event', event] });
  const flag = event => ({ $max: { $cond: [is(event), 1, 0] } });
  const count = event => ({ $sum: { $cond: [is(event), 1, 0] } });
  const other = { $not: [{ $in: ['$event', ['page_view', 'product_view', 'add_to_cart', 'checkout_start', 'purchase']] }] };
  const rows = await Event.aggregate([
    { $match: match },
    { $group: {
      _id: '$sessionId', events: { $sum: 1 },
      identified: { $max: { $cond: [{ $and: [
        { $ne: ['$userId', null] }, { $ne: ['$userId', ''] }
      ] }, 1, 0] } },
      pageSessions: flag('page_view'), pageViews: count('page_view'),
      productSessions: flag('product_view'),
      cartSessions: flag('add_to_cart'), cartEvents: count('add_to_cart'),
      checkoutSessions: flag('checkout_start'),
      purchasingSessions: flag('purchase'), purchaseEvents: count('purchase'),
      customEvents: { $sum: { $cond: [other, 1, 0] } },
    } },
    { $group: {
      _id: null, sessions: { $sum: 1 }, events: { $sum: '$events' },
      identifiedSessions: { $sum: '$identified' },
      pageSessions: { $sum: '$pageSessions' }, pageViews: { $sum: '$pageViews' },
      productSessions: { $sum: '$productSessions' },
      cartSessions: { $sum: '$cartSessions' }, cartEvents: { $sum: '$cartEvents' },
      checkoutSessions: { $sum: '$checkoutSessions' },
      purchasingSessions: { $sum: '$purchasingSessions' }, purchaseEvents: { $sum: '$purchaseEvents' },
      customEvents: { $sum: '$customEvents' },
    } },
  ]).option({ maxTimeMS: 15000 });
  const r = rows[0] || { sessions: 0, events: 0, identifiedSessions: 0, purchasingSessions: 0 };
  return {
    scope: { start: f.start.toISOString(), end: f.end.toISOString() },
    current: r,
    facts: buildHomeFacts(r),
  };
}
module.exports = { getHomeSummary, buildHomeFacts };
