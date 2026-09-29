const Event = require('../models/Event');
const { getLoyalUserIds } = require('./aggregations');

const PERIOD_DAYS = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '180d': 180 };
const PLATFORM_DEVICE_MAP = {
  web: ['Desktop'],
  app: ['Mobile', 'Tablet'],
};

function parseDateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function resolveDateRange(period, customRange) {
  if (period === 'custom' && customRange?.from && customRange?.to) {
    const start = new Date(customRange.from);
    let end = new Date(customRange.to);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('Invalid custom date range');
    }

    // UI date inputs are date-only. Treat "to" as inclusive by converting it
    // to an exclusive next-day boundary, which works naturally with $lt.
    if (parseDateOnly(customRange.to)) {
      end.setUTCDate(end.getUTCDate() + 1);
    }

    if (end <= start) throw new Error('Custom range end must be after start');
    return { start, end };
  }

  const normalizedPeriod = period || '30d';
  const days = PERIOD_DAYS[normalizedPeriod];
  if (!days) throw new Error(`Unsupported period: ${normalizedPeriod}`);
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

function normalizeDevice(device) {
  if (!device) return null;
  const value = String(device).toLowerCase();
  if (value === 'desktop') return 'Desktop';
  if (value === 'mobile') return 'Mobile';
  if (value === 'tablet') return 'Tablet';
  return device;
}

function applyPlatformDeviceFilter(match, platform, device) {
  const normalizedDevice = normalizeDevice(device);
  if (normalizedDevice) {
    match['deviceInfo.deviceType'] = normalizedDevice;
  } else if (platform && platform !== 'combined' && PLATFORM_DEVICE_MAP[platform]) {
    match['deviceInfo.deviceType'] = { $in: PLATFORM_DEVICE_MAP[platform] };
  }
  return match;
}

async function getPersonaUserIds(projectId, personas, start, end) {
  if (!personas?.length) return null;
  if (!projectId) throw new Error('projectId is required for persona resolution');

  const needLoyal = personas.some((p) => ['loyal', 'firsttime', 'active'].includes(p));
  const needFirstTime = personas.some((p) => ['firsttime', 'active'].includes(p));
  const needActive = personas.includes('active');

  const [loyalIds, firstTimeRows, activeRows] = await Promise.all([
    needLoyal ? getLoyalUserIds(projectId) : Promise.resolve(new Set()),
    needFirstTime
      ? Event.aggregate([
          {
            $match: {
              projectId,
              event: 'sign_up',
              timestamp: { $gte: start, $lt: end },
              userId: { $ne: null },
            },
          },
          { $group: { _id: '$userId' } },
        ])
      : Promise.resolve([]),
    needActive
      ? Event.aggregate([
          {
            // A known user with any activity in the selected window is active.
            // Loyal and first-time users are removed below so personas remain
            // mutually exclusive: loyal > firsttime > active > guest.
            $match: {
              projectId,
              timestamp: { $gte: start, $lt: end },
              userId: { $ne: null },
            },
          },
          { $group: { _id: '$userId' } },
        ])
      : Promise.resolve([]),
  ]);

  const firsttimeSet = new Set(firstTimeRows.map((row) => row._id));
  const activeSet = new Set(activeRows.map((row) => row._id));
  const ids = new Set();

  if (personas.includes('loyal')) loyalIds.forEach((id) => ids.add(id));
  if (personas.includes('firsttime')) {
    firsttimeSet.forEach((id) => {
      if (!loyalIds.has(id)) ids.add(id);
    });
  }
  if (personas.includes('active')) {
    activeSet.forEach((id) => {
      if (!loyalIds.has(id) && !firsttimeSet.has(id)) ids.add(id);
    });
  }

  return { ids, includeGuest: personas.includes('guest') };
}

function applyPersonaFilter(match, personaFilter) {
  if (!personaFilter) return match;

  const orConditions = [];
  if (personaFilter.ids.size > 0) {
    orConditions.push({ userId: { $in: [...personaFilter.ids] } });
  }
  if (personaFilter.includeGuest) orConditions.push({ userId: null });

  match.$or = orConditions.length ? orConditions : [{ userId: { $in: [] } }];
  return match;
}

module.exports = {
  resolveDateRange,
  normalizeDevice,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
  applyPersonaFilter,
  PLATFORM_DEVICE_MAP,
};
