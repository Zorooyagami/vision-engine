const Event = require('../models/Event');
const User = require('../models/User');

const FUNNEL_STAGES = ['product_view', 'add_to_cart', 'view_cart', 'checkout_start', 'purchase'];

async function getFunnel(filters = {}) {
  const match = { projectId: filters.projectId };
  if (filters.startDate || filters.endDate) {
    match.timestamp = {};
    if (filters.startDate) match.timestamp.$gte = new Date(filters.startDate);
    if (filters.endDate) match.timestamp.$lte = new Date(filters.endDate);
  }
  if (filters.deviceType) match['deviceInfo.deviceType'] = filters.deviceType;
  if (filters.trafficSource) match.trafficSource = filters.trafficSource;

  const [result] = await Event.aggregate([
    { $match: match },
    { $group: { _id: '$sessionId', eventTypes: { $addToSet: '$event' } } },
    {
      $facet: Object.fromEntries(
        FUNNEL_STAGES.map((stage) => [stage, [{ $match: { eventTypes: stage } }, { $count: 'count' }]])
      ),
    },
  ]);

  const counts = {};
  for (const stage of FUNNEL_STAGES) counts[stage] = result?.[stage]?.[0]?.count || 0;

  return FUNNEL_STAGES.map((stage, index) => {
    const count = counts[stage];
    const previous = index ? counts[FUNNEL_STAGES[index - 1]] : count;
    return {
      stage,
      count,
      dropoffRate: index === 0 || !previous ? 0 : Math.round((1 - count / previous) * 100),
    };
  });
}

async function getLoyalCustomer(filters = {}) {
  return Event.aggregate([
    { $match: { projectId: filters.projectId, event: 'purchase', userId: { $ne: null } } },
    {
      $group: {
        _id: '$userId',
        orderCount: { $sum: 1 },
        revenue: {
          $sum: {
            $convert: { input: '$properties.total', to: 'double', onError: 0, onNull: 0 },
          },
        },
      },
    },
    { $match: { orderCount: { $gte: 2 } } },
    { $sort: { orderCount: -1 } },
  ]);
}

async function getGamers(filters = {}) {
  return Event.find({
    projectId: filters.projectId,
    event: 'purchase',
    'properties.products.subCategory': 'Gaming',
  }).lean();
}

async function getUsersByPeriod(projectId, period = '1m') {
  const now = new Date();
  const startDate = new Date(now);
  const periods = {
    '1d': () => startDate.setDate(now.getDate() - 1),
    '1w': () => startDate.setDate(now.getDate() - 7),
    '1m': () => startDate.setMonth(now.getMonth() - 1),
    '3m': () => startDate.setMonth(now.getMonth() - 3),
    '6m': () => startDate.setMonth(now.getMonth() - 6),
  };
  if (!periods[period]) throw new Error(`Unsupported period: ${period}`);
  periods[period]();

  const scope = projectId ? { projectId } : { projectId: null };
  const [totalUsers, users] = await Promise.all([
    User.countDocuments(scope),
    User.find(
      { ...scope, createdAt: { $gte: startDate, $lte: now } },
      { _id: 0, userId: 1 }
    ).lean(),
  ]);

  const count = users.length;
  return {
    period,
    count,
    percentage: totalUsers ? Number(((count / totalUsers) * 100).toFixed(2)) : 0,
    totalUsers,
    userIds: users.map(({ userId }) => userId),
  };
}

module.exports = { getFunnel, getLoyalCustomer, getGamers, getUsersByPeriod };
