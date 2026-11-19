//services/filterHelpers.js
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
  if (!device || String(device).toLowerCase() === 'all') return null;
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

// Stream user IDs instead of creating a large MongoDB $group in memory.
async function uniqueUserIds(match) {
  const ids = new Set();
  const query = Event.find(match).select('userId -_id').lean()
    .maxTimeMS(Math.min(120000, Math.max(15000, Number(process.env.INTELLIGENCE_QUERY_TIMEOUT_MS) || 45000)));
  for await (const row of query.cursor({ batchSize: 1000 })) {
    if (row.userId) ids.add(row.userId);
  }
  return ids;
}

async function getPersonaUserIds(projectId, personas, start, end, { loyalIds: precomputedLoyalIds } = {}) {
  if (!personas?.length) return null;
  if (!projectId) throw new Error('projectId is required for persona resolution');

  const dynamic = personas.filter(p => /^dynamic:[a-f0-9]{24}$/.test(p));
  if(personas.some(p => !['loyal','firsttime','active','guest'].includes(p) && !dynamic.includes(p))) throw new Error('Unsupported persona');
  const resolved = dynamic.length ? await require('./behavior/store').resolveApproved(projectId,dynamic,end) : {sessions:new Set()};
  const needLoyal = personas.some((p) => ['loyal', 'firsttime', 'active'].includes(p));
  const needFirstTime = personas.some((p) => ['firsttime', 'active'].includes(p));
  const needActive = personas.includes('active');

  const [loyalIds, firstTimeRows, activeRows] = await Promise.all([
    needLoyal ? (precomputedLoyalIds ? Promise.resolve(precomputedLoyalIds) : getLoyalUserIds(projectId)) : Promise.resolve(new Set()),
    needFirstTime
      ? uniqueUserIds({ projectId, event: 'sign_up', timestamp: { $gte: start, $lt: end }, userId: { $nin: [null, ''] } })
      : Promise.resolve([]),
    needActive
      ? uniqueUserIds({ projectId, timestamp: { $gte: start, $lt: end }, userId: { $nin: [null, ''] } })
      : Promise.resolve([]),
  ]);

  const firsttimeSet = firstTimeRows;
  const activeSet = activeRows;
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

  return { ids, sessions:resolved.sessions, includeGuest: personas.includes('guest') };
}

function applyPersonaFilter(match, personaFilter) {
  if (!personaFilter) return match;

  const orConditions = [];
  if (personaFilter.ids.size > 0) {
    orConditions.push({ userId: { $in: [...personaFilter.ids] } });
  }
  if(personaFilter.sessions?.size) orConditions.push({sessionId:{$in:[...personaFilter.sessions]}});
  if (personaFilter.includeGuest) orConditions.push({ userId: null });

  const condition = { $or: orConditions.length ? orConditions : [{ userId: { $in: [] } }] };
  if(match.$or) { match.$and=[...(match.$and||[]),condition]; } else { Object.assign(match,condition); }
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
