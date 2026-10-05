//vision-engine/services/aggregations.js
const Event = require('../models/Event');

async function getLoyalUserIds(projectId) {
  const rows = await Event.aggregate([
    { $match: { projectId, event: 'purchase', userId: { $ne: null } } },
    { $group: { _id: '$userId', orderCount: { $sum: 1 } } },
    // Existing product definition: 2+ purchases = loyal.
    { $match: { orderCount: { $gte: 2 } } },
  ]);
  return new Set(rows.map((row) => row._id));
}

async function getFirstTimeUserIds(projectId, start, end) {
  const rows = await Event.aggregate([
    {
      $match: {
        projectId,
        event: 'sign_up',
        timestamp: { $gte: start, $lt: end },
        userId: { $ne: null },
      },
    },
    { $group: { _id: '$userId' } },
  ]);
  return new Set(rows.map((row) => row._id));
}

async function getActiveUserIds(projectId, start, end) {
  const rows = await Event.aggregate([
    {
      // userId on any event means this was a known/logged-in user during the
      // selected period. Higher-priority personas are excluded by the caller.
      $match: {
        projectId,
        timestamp: { $gte: start, $lt: end },
        userId: { $ne: null },
      },
    },
    { $group: { _id: '$userId' } },
  ]);
  return new Set(rows.map((row) => row._id));
}

async function classifyPersonas(projectId, start, end) {
  const [loyalIds, firstTimeIds, activeIds] = await Promise.all([
    getLoyalUserIds(projectId),
    getFirstTimeUserIds(projectId, start, end),
    getActiveUserIds(projectId, start, end),
  ]);

  const byPersona = { loyal: [], firsttime: [], active: [] };
  loyalIds.forEach((id) => byPersona.loyal.push(id));
  firstTimeIds.forEach((id) => {
    if (!loyalIds.has(id)) byPersona.firsttime.push(id);
  });
  activeIds.forEach((id) => {
    if (!loyalIds.has(id) && !firstTimeIds.has(id)) byPersona.active.push(id);
  });
  return byPersona;
}

async function sessionCountFor(match) {
  const rows = await Event.aggregate([
    { $match: match },
    { $group: { _id: '$sessionId' } },
    { $count: 'count' },
  ]);
  return rows[0]?.count || 0;
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

async function personaMetricsForWindow(projectId, start, end) {
  const byPersona = await classifyPersonas(projectId, start, end);
  const result = {};

  for (const persona of ['loyal', 'firsttime', 'active']) {
    const ids = byPersona[persona];
    if (!ids.length) {
      result[persona] = { sessionCount: 0, checkouts: 0, conversionRate: 0, revenue: 0 };
      continue;
    }

    const match = {
      projectId,
      userId: { $in: ids },
      timestamp: { $gte: start, $lt: end },
    };
    const [sessionCount, purchase] = await Promise.all([
      sessionCountFor(match),
      purchaseStatsFor(match),
    ]);

    result[persona] = {
      sessionCount,
      checkouts: purchase.checkouts,
      revenue: purchase.revenue,
      conversionRate: sessionCount ? purchase.checkouts / sessionCount : 0,
    };
  }

  const guestMatch = { projectId, userId: null, timestamp: { $gte: start, $lt: end } };
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

async function genericMetricsForWindow(projectId, start, end) {
  const match = { projectId, timestamp: { $gte: start, $lt: end } };

  const [sessionCount, purchase, deviceSplitRows, topCategoryRows, bounceRows] = await Promise.all([
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
          singleEventSessions: {
            $sum: { $cond: [{ $eq: ['$eventCount', 1] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  return {
    overallConversionRate: sessionCount ? purchase.checkouts / sessionCount : 0,
    overallRevenue: purchase.revenue,
    overallSessionCount: sessionCount,
    deviceSplit: deviceSplitRows,
    topProductCategory: topCategoryRows[0]?._id || null,
    bounceRate: bounceRows[0]
      ? bounceRows[0].singleEventSessions / bounceRows[0].totalSessions
      : 0,
  };
}

module.exports = {
  personaMetricsForWindow,
  genericMetricsForWindow,
  getLoyalUserIds,
  classifyPersonas,
};
