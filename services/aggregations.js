const Event = require('../models/Event');

// ---- Persona classification -------------------------------------------

// "loyal" is a lifetime trait (>2 orders ever), not scoped to any window
async function getLoyalUserIds() {
  const rows = await Event.aggregate([
    { $match: { event: 'purchase', userId: { $ne: null } } },
    { $group: { _id: '$userId', orderCount: { $sum: 1 } } },
    { $match: { orderCount: { $gt: 2 } } },
  ]);
  return new Set(rows.map((r) => r._id));
}

async function getFirstTimeUserIds(start, end) {
  const rows = await Event.aggregate([
    { $match: { event: 'sign_up', timestamp: { $gte: start, $lt: end }, userId: { $ne: null } } },
    { $group: { _id: '$userId' } },
  ]);
  return new Set(rows.map((r) => r._id));
}

async function getActiveUserIds(start, end) {
  const rows = await Event.aggregate([
    { $match: { event: 'login', timestamp: { $gte: start, $lt: end }, userId: { $ne: null } } },
    { $group: { _id: '$userId' } },
  ]);
  return new Set(rows.map((r) => r._id));
}

// Priority: loyal > firsttime > active
async function classifyPersonas(start, end) {
  const [loyalIds, firstTimeIds, activeIds] = await Promise.all([
    getLoyalUserIds(),
    getFirstTimeUserIds(start, end),
    getActiveUserIds(start, end),
  ]);

  const byPersona = { loyal: [], firsttime: [], active: [] };
  loyalIds.forEach((id) => byPersona.loyal.push(id));
  firstTimeIds.forEach((id) => { if (!loyalIds.has(id)) byPersona.firsttime.push(id); });
  activeIds.forEach((id) => {
    if (!loyalIds.has(id) && !firstTimeIds.has(id)) byPersona.active.push(id);
  });

  return byPersona;
}

// ---- Per-persona conversion + revenue ----------------------------------

async function sessionCountFor(match) {
  const rows = await Event.aggregate([
    { $match: match },
    { $group: { _id: null, sessions: { $addToSet: '$sessionId' } } },
  ]);
  return rows[0]?.sessions.length || 0;
}

async function purchaseStatsFor(match) {
  const rows = await Event.aggregate([
    { $match: { ...match, event: 'purchase' } },
    {
      $group: {
        _id: null,
        checkouts: { $sum: 1 },
        revenue: {
          $sum: {
            $convert: { input: '$properties.total', to: 'double', onError: 0, onNull: 0 },
          },
        },
      },
    },
  ]);
  return { checkouts: rows[0]?.checkouts || 0, revenue: rows[0]?.revenue || 0 };
}

async function personaMetricsForWindow(start, end) {
  const byPersona = await classifyPersonas(start, end);
  const result = {};

  for (const persona of ['loyal', 'firsttime', 'active']) {
    const ids = byPersona[persona];
    if (ids.length === 0) {
      result[persona] = { sessionCount: 0, checkouts: 0, conversionRate: 0, revenue: 0 };
      continue;
    }
    const match = { userId: { $in: ids }, timestamp: { $gte: start, $lt: end } };
    const [sessionCount, { checkouts, revenue }] = await Promise.all([
      sessionCountFor(match),
      purchaseStatsFor(match),
    ]);
    result[persona] = {
      sessionCount,
      checkouts,
      revenue,
      conversionRate: sessionCount ? checkouts / sessionCount : 0,
    };
  }

  // guests: userId is null on the event itself — no join needed
  const guestMatch = { userId: null, timestamp: { $gte: start, $lt: end } };
  const [guestSessionCount, guestPurchase] = await Promise.all([
    sessionCountFor(guestMatch),
    purchaseStatsFor(guestMatch),
  ]);
  result.guest = {
    sessionCount: guestSessionCount,
    checkouts: guestPurchase.checkouts,
    revenue: guestPurchase.revenue,
    conversionRate: guestSessionCount ? guestPurchase.checkouts / guestSessionCount : 0,
  };

  return result;
}

// ---- Generic, platform-wide metrics -------------------------------------

async function genericMetricsForWindow(start, end) {
  const match = { timestamp: { $gte: start, $lt: end } };

  const [sessionCount, { checkouts, revenue }, deviceSplitRows, topCategoryRows, bounceRows] =
    await Promise.all([
      sessionCountFor(match),
      purchaseStatsFor(match),
      Event.aggregate([
        { $match: match },
        { $group: { _id: '$deviceInfo.deviceType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Event.aggregate([
        { $match: { ...match, event: 'product_view' } },
        { $group: { _id: '$properties.category', views: { $sum: 1 } } },
        { $sort: { views: -1 } },
        { $limit: 1 },
      ]),
      Event.aggregate([
        { $match: match },
        { $group: { _id: '$sessionId', eventCount: { $sum: 1 } } },
        {
          $group: {
            _id: null,
            totalSessions: { $sum: 1 },
            singleEventSessions: { $sum: { $cond: [{ $eq: ['$eventCount', 1] }, 1, 0] } },
          },
        },
      ]),
    ]);

  return {
    overallConversionRate: sessionCount ? checkouts / sessionCount : 0,
    overallRevenue: revenue,
    overallSessionCount: sessionCount,
    deviceSplit: deviceSplitRows, // [{ _id: 'Mobile', count: N }, ...]
    topProductCategory: topCategoryRows[0]?._id || null,
    bounceRate: bounceRows[0]
      ? bounceRows[0].singleEventSessions / bounceRows[0].totalSessions
      : 0,
  };
}
// aggregations.js — bottom of file
module.exports = { personaMetricsForWindow, genericMetricsForWindow, getLoyalUserIds };
