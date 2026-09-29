const Event = require('../models/Event');
const { normalizeDevice } = require('./filterHelpers');

async function coreMetrics(match, deviceType = 'all') {
  const normalizedDevice = deviceType && String(deviceType).toLowerCase() !== 'all'
    ? normalizeDevice(deviceType)
    : null;
  const deviceMatch = normalizedDevice
    ? { ...match, 'deviceInfo.deviceType': normalizedDevice }
    : match;

  const [result] = await Event.aggregate([
    { $match: deviceMatch },
    {
      $facet: {
        purchases: [
          { $match: { event: 'purchase' } },
          {
            $group: {
              _id: null,
              revenue: {
                $sum: {
                  $convert: { input: '$properties.total', to: 'double', onError: 0, onNull: 0 },
                },
              },
              purchaseCount: { $sum: 1 },
            },
          },
        ],
        sessions: [
          { $group: { _id: '$sessionId' } },
          { $count: 'count' },
        ],
        users: [
          { $match: { userId: { $ne: null } } },
          { $group: { _id: '$userId' } },
          { $count: 'count' },
        ],
      },
    },
  ]);

  const revenue = result?.purchases?.[0]?.revenue || 0;
  const purchaseCount = result?.purchases?.[0]?.purchaseCount || 0;
  const sessionCount = result?.sessions?.[0]?.count || 0;
  const activeUsers = result?.users?.[0]?.count || 0;

  return {
    revenue: Number(revenue.toFixed(2)),
    activeUsers,
    conversionRate: sessionCount
      ? Number(((purchaseCount / sessionCount) * 100).toFixed(2))
      : 0,
    avgOrderValue: purchaseCount
      ? Number((revenue / purchaseCount).toFixed(2))
      : 0,
  };
}

function pctChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

async function getKPIs(req, res) {
  try {
    const { period, persona, range, baseMatch, prevMatch } = req.analytics;
    const deviceType = req.query.deviceType || 'all';
    const [current, previous] = await Promise.all([
      coreMetrics(baseMatch, deviceType),
      prevMatch ? coreMetrics(prevMatch, deviceType) : Promise.resolve(null),
    ]);

    res.json({
      period,
      persona,
      deviceType,
      range: range || 'all-time',
      kpis: {
        revenue: { value: current.revenue, change: previous ? pctChange(current.revenue, previous.revenue) : null },
        activeUsers: { value: current.activeUsers, change: previous ? pctChange(current.activeUsers, previous.activeUsers) : null },
        conversionRate: { value: current.conversionRate, change: previous ? pctChange(current.conversionRate, previous.conversionRate) : null },
        avgOrderValue: { value: current.avgOrderValue, change: previous ? pctChange(current.avgOrderValue, previous.avgOrderValue) : null },
      },
    });
  } catch (err) {
    console.error('[analytics/kpis] failed:', err);
    res.status(400).json({ error: err.message });
  }
}

async function getRevenueTrend(req, res) {
  try {
    const match = { ...req.analytics.baseMatch, event: 'purchase' };
    const normalizedDevice = normalizeDevice(req.query.deviceType);
    if (normalizedDevice) match['deviceInfo.deviceType'] = normalizedDevice;

    const revenue = await Event.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          revenue: {
            $sum: {
              $convert: { input: '$properties.total', to: 'double', onError: 0, onNull: 0 },
            },
          },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', revenue: 1, orders: 1 } },
    ]);

    res.json({
      deviceType: normalizedDevice || 'All',
      totalRevenue: revenue.reduce((sum, row) => sum + row.revenue, 0),
      totalOrders: revenue.reduce((sum, row) => sum + row.orders, 0),
      trend: revenue,
    });
  } catch (err) {
    console.error('[analytics/revenue-trend] failed:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getKPIs, getRevenueTrend, coreMetrics };
