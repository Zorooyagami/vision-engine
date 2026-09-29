const Event = require('../models/Event');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
} = require('./filterHelpers');

const PERSONA_KEYS = ['loyal', 'firsttime', 'active', 'guest'];

async function getRevenueByPersona({
  projectId,
  period = '30d',
  customRange,
  platform = 'combined',
  device,
}) {
  const { start, end } = resolveDateRange(period, customRange);
  const baseMatch = {
    projectId,
    timestamp: { $gte: start, $lt: end },
    event: 'purchase',
  };
  applyPlatformDeviceFilter(baseMatch, platform, device);

  const results = await Promise.all(
    PERSONA_KEYS.map(async (key) => {
      const match = { ...baseMatch };
      if (key === 'guest') {
        match.userId = null;
      } else {
        const filter = await getPersonaUserIds(projectId, [key], start, end);
        const ids = filter ? [...filter.ids] : [];
        match.userId = { $in: ids.length ? ids : ['__no_match__'] };
      }

      const [agg] = await Event.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            revenue: {
              $sum: {
                $convert: { input: '$properties.total', to: 'double', onError: 0, onNull: 0 },
              },
            },
          },
        },
      ]);

      return { id: key, orders: agg?.orders || 0, revenue: agg?.revenue || 0 };
    })
  );

  const totalRevenue = results.reduce((sum, row) => sum + row.revenue, 0);
  return results.map((row) => ({
    ...row,
    aov: row.orders ? Math.round(row.revenue / row.orders) : 0,
    pct: totalRevenue ? +((row.revenue / totalRevenue) * 100).toFixed(1) : 0,
  }));
}

async function getStackedRevenueByPersona({
  projectId,
  period = '30d',
  customRange,
  platform = 'combined',
  device,
}) {
  const { start, end } = resolveDateRange(period, customRange);
  const baseMatch = {
    projectId,
    timestamp: { $gte: start, $lt: end },
    event: 'purchase',
  };
  applyPlatformDeviceFilter(baseMatch, platform, device);

  const [loyalFilter, firsttimeFilter, activeFilter] = await Promise.all([
    getPersonaUserIds(projectId, ['loyal'], start, end),
    getPersonaUserIds(projectId, ['firsttime'], start, end),
    getPersonaUserIds(projectId, ['active'], start, end),
  ]);

  const loyalIds = loyalFilter?.ids || new Set();
  const firsttimeIds = firsttimeFilter?.ids || new Set();
  const activeIds = activeFilter?.ids || new Set();

  const purchases = await Event.find(
    baseMatch,
    { timestamp: 1, userId: 1, 'properties.total': 1 }
  ).lean();

  const monthly = {};
  for (const purchase of purchases) {
    const month = new Date(purchase.timestamp).toLocaleString('en-US', { month: 'short' });
    let persona = 'guest';
    if (purchase.userId) {
      if (loyalIds.has(purchase.userId)) persona = 'loyal';
      else if (firsttimeIds.has(purchase.userId)) persona = 'firsttime';
      else if (activeIds.has(purchase.userId)) persona = 'active';
      else persona = 'active';
    }

    const totalK = (Number(purchase.properties?.total) || 0) / 1000;
    monthly[month] = monthly[month] || {};
    monthly[month][persona] = (monthly[month][persona] || 0) + totalK;
  }

  Object.keys(monthly).forEach((month) => {
    PERSONA_KEYS.forEach((key) => {
      monthly[month][key] = Math.round(monthly[month][key] || 0);
    });
  });

  return monthly;
}

module.exports = { getRevenueByPersona, getStackedRevenueByPersona, PERSONA_KEYS };
