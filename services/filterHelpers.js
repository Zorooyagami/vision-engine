// services/filterHelpers.js
const { getLoyalUserIds } = require('./aggregations');
const Event = require('../models/Event');

const PERIOD_DAYS = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '180d': 180 };

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

function applyPlatformDeviceFilter(match, platform, device) {
  if (device) {
    match['deviceInfo.deviceType'] = device;
  } else if (platform && platform !== 'combined' && PLATFORM_DEVICE_MAP[platform]) {
    match['deviceInfo.deviceType'] = { $in: PLATFORM_DEVICE_MAP[platform] };
  }
}

async function getPersonaUserIds(personas, start, end) {
  if (!personas?.length) return null;

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

function applyPersonaFilter(match, personaFilter) {
  if (!personaFilter) return;
  const orConditions = [];
  if (personaFilter.ids.size > 0) orConditions.push({ userId: { $in: [...personaFilter.ids] } });
  if (personaFilter.includeGuest) orConditions.push({ userId: null });
  match.$or = orConditions.length ? orConditions : [{ userId: { $in: [] } }]; // selected personas resolve to nobody
}

module.exports = {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
  applyPersonaFilter,
  PLATFORM_DEVICE_MAP,
};