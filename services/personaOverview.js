const Event = require('../models/Event');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
} = require('./filterHelpers');

const PERSONA_KEYS = ['loyal', 'firsttime', 'active', 'guest'];
const MONTHS_BACK = 6;

function monthLabel(date) {
  return date.toLocaleString('en-US', { month: 'short' });
}

function getMonthWindows(n) {
  const windows = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    windows.push({ start, end, label: monthLabel(start) });
  }
  return windows;
}

// Resolves a persona key to either a guest match (userId: null) or a real user-id set
async function resolvePersonaSelector(key, start, end) {
  if (key === 'guest') return { type: 'guest' };
  const filter = await getPersonaUserIds([key], start, end);
  const ids = filter ? [...filter.ids] : [];
  return { type: 'users', ids };
}

function applyPersonaSelector(match, sel) {
  if (sel.type === 'guest') {
    match.userId = null;
  } else {
    match.userId = { $in: sel.ids.length ? sel.ids : ['__no_match__'] };
  }
}

// Distinct-session count for a persona within a window (used for headcount + trend)
async function countActive(key, start, end, platform, device) {
  const sel = await resolvePersonaSelector(key, start, end);
  const match = { timestamp: { $gte: start, $lt: end } };
  applyPersonaSelector(match, sel);
  applyPlatformDeviceFilter(match, platform, device);

  if (sel.type === 'guest') {
    const rows = await Event.aggregate([
      { $match: match },
      { $group: { _id: '$sessionId' } },
      { $count: 'count' },
    ]);
    return rows[0]?.count || 0;
  }
  return sel.ids.length;
}

async function getPersonaMetrics(key, start, end, platform, device) {
  const sel = await resolvePersonaSelector(key, start, end);
  const baseMatch = { timestamp: { $gte: start, $lt: end } };
  applyPersonaSelector(baseMatch, sel);
  applyPlatformDeviceFilter(baseMatch, platform, device);

  const [sessionRows, purchaseAgg, deviceRows] = await Promise.all([
    Event.aggregate([{ $match: baseMatch }, { $group: { _id: '$sessionId' } }, { $count: 'count' }]),
    Event.aggregate([
      { $match: { ...baseMatch, event: 'purchase' } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: { $convert: { input: '$properties.total', to: 'double', onError: 0, onNull: 0 } } },
        },
      },
    ]),
    Event.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$deviceInfo.deviceType', count: { $sum: 1 } } },
    ]),
  ]);

  const sessions = sessionRows[0]?.count || 0;
  const orders = purchaseAgg[0]?.orders || 0;
  const revenue = purchaseAgg[0]?.revenue || 0;

  const deviceTotal = deviceRows.reduce((s, r) => s + r.count, 0) || 1;
  const webCount = deviceRows.filter((r) => r._id === 'Desktop').reduce((s, r) => s + r.count, 0);
  const appCount = deviceRows.filter((r) => r._id === 'Mobile' || r._id === 'Tablet').reduce((s, r) => s + r.count, 0);

  return {
    sessions,
    orders,
    revenue,
    aov: orders ? Math.round(revenue / orders) : 0,
    convRate: sessions ? +((orders / sessions) * 100).toFixed(1) : 0,
    webPct: Math.round((webCount / deviceTotal) * 100),
    appPct: Math.round((appCount / deviceTotal) * 100),
    count: sel.type === 'guest' ? sessions : sel.ids.length,
  };
}

// Retention: of users classified into this persona in the PRIOR 30d window,
// what % also appear in the persona during the CURRENT 30d window.
// Guests have no stable identity across sessions, so retention isn't meaningful — returns null.
async function getRetention(key, end) {
  if (key === 'guest') return null;

  const curStart = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const prevEnd = curStart;
  const prevStart = new Date(prevEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [curFilter, prevFilter] = await Promise.all([
    getPersonaUserIds([key], curStart, end),
    getPersonaUserIds([key], prevStart, prevEnd),
  ]);
  const curIds = curFilter ? curFilter.ids : new Set();
  const prevIds = prevFilter ? [...prevFilter.ids] : [];

  if (!prevIds.length) return null;
  const returned = prevIds.filter((id) => curIds.has(id)).length;
  return +((returned / prevIds.length) * 100).toFixed(1);
}

async function getPersonaOverview({ period = '30d', customRange, platform = 'combined', device }) {
  const { start, end } = resolveDateRange(period, customRange);
  const spanMs = end - start;
  const prevStart = new Date(start.getTime() - spanMs);
  const prevEnd = start;

  const monthWindows = getMonthWindows(MONTHS_BACK);

  const rows = await Promise.all(
    PERSONA_KEYS.map(async (key) => {
      const [metrics, prevCount, retention, trendPoints] = await Promise.all([
        getPersonaMetrics(key, start, end, platform, device),
        countActive(key, prevStart, prevEnd, platform, device),
        getRetention(key, end),
        Promise.all(
          monthWindows.map(async (w) => ({
            label: w.label,
            count: await countActive(key, w.start, w.end, platform, device),
          }))
        ),
      ]);

      const trendPct = prevCount
        ? +(((metrics.count - prevCount) / prevCount) * 100).toFixed(1)
        : null;

      return {
        id: key,
        count: metrics.count,
        revenue: metrics.revenue,
        aov: metrics.aov,
        convRate: metrics.convRate,
        retention,
        webPct: metrics.webPct,
        appPct: metrics.appPct,
        trendPct,
        trend: trendPoints.map((t) => t.count),
        trendLabels: trendPoints.map((t) => t.label),
      };
    })
  );

  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  return rows.map((r) => ({ ...r, pct: totalCount ? +((r.count / totalCount) * 100).toFixed(1) : 0 }));
}

module.exports = { getPersonaOverview };