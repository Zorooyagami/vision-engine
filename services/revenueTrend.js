// services/revenueTrend.js
const Event = require('../models/Event');

// Same persona classification logic as aggregations.js — reused here
const { getLoyalUserIds } = require('./aggregations'); // export this from aggregations.js if not already

const PERIOD_DAYS = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '180d': 180 };

// crude platform proxy — Desktop counts as "web", Mobile/Tablet as "app"
const PLATFORM_DEVICE_MAP = {
  web: ['Desktop'],
  app: ['Mobile', 'Tablet'],
};

function resolveDateRange(period, customRange) {
  if (period === 'custom' && customRange?.from && customRange?.to) {
    return { start: new Date(customRange.from), end: new Date(customRange.to) };
  }
  const days = PERIOD_DAYS[period] || 30;
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

function resolveBucketing(start, end) {
  const spanDays = (end - start) / (24 * 60 * 60 * 1000);
  return { unit: 'month', format: '%Y-%m-%d ' };
  if (spanDays <= 2) return { unit: 'hour', format: '%Y-%m-%d %H:00' };
  if (spanDays <= 45) return { unit: 'day', format: '%Y-%m-%d' };
  if (spanDays <= 120) return { unit: 'week', format: '%Y-%U' };
  return { unit: 'month', format: '%Y-%m' };
}

async function getPersonaUserIds(personas, start, end) {
  if (!personas?.length) return null; // null = no persona filter

  const [loyalIds, firstTimeRows, activeRows] = await Promise.all([
    personas.includes('loyal') ? getLoyalUserIds() : Promise.resolve(new Set()),
    personas.includes('firsttime')
      ? Event.aggregate([
          { $match: { event: 'sign_up', timestamp: { $gte: start, $lt: end }, userId: { $ne: null } } },
          { $group: { _id: '$userId' } },
        ])
      : Promise.resolve([]),
    personas.includes('active')
      ? Event.aggregate([
          { $match: { event: 'login', timestamp: { $gte: start, $lt: end }, userId: { $ne: null } } },
          { $group: { _id: '$userId' } },
        ])
      : Promise.resolve([]),
  ]);

  const ids = new Set();
  if (personas.includes('loyal')) loyalIds.forEach((id) => ids.add(id));
  if (personas.includes('firsttime')) firstTimeRows.forEach((r) => ids.add(r._id));
  if (personas.includes('active')) activeRows.forEach((r) => ids.add(r._id));

  return { ids, includeGuest: personas.includes('guest') };
}

async function getRevenueTrend({ period = '30d', customRange, personas = [], platform = 'combined', device }) {
  const { start, end } = resolveDateRange(period, customRange);
  const { format } = resolveBucketing(start, end);

  const match = {
    event: 'purchase',
    timestamp: { $gte: start, $lt: end },
  };

  // device filter (explicit) takes precedence over platform proxy
  if (device) {
    match['deviceInfo.deviceType'] = device;
  } else if (platform !== 'combined' && PLATFORM_DEVICE_MAP[platform]) {
    match['deviceInfo.deviceType'] = { $in: PLATFORM_DEVICE_MAP[platform] };
  }

  const personaFilter = await getPersonaUserIds(personas, start, end);
  if (personaFilter) {
    const orConditions = [];
    if (personaFilter.ids.size > 0) orConditions.push({ userId: { $in: [...personaFilter.ids] } });
    if (personaFilter.includeGuest) orConditions.push({ userId: null });
    match.$or = orConditions.length ? orConditions : [{ userId: { $in: [] } }]; // no match if nothing selected resolves
  }

  const rows = await Event.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format, date: '$timestamp' } },
        value: {
          $sum: { $convert: { input: '$properties.total', to: 'double', onError: 0, onNull: 0 } },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((r) => ({ label: r._id, value: Math.round(r.value / 1000) })); // in $K to match chart's formatValue
}

module.exports = { getRevenueTrend };