//vision-engine/services/personaExplorer.js
const Event = require('../models/Event');
const { getLoyalUserIds } = require('./aggregations');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
} = require('./filterHelpers');

const PERSONA_KEYS = ['loyal', 'firsttime', 'active', 'guest'];

const PERSONA_RULES = {
  loyal: '2+ lifetime purchases',
  firsttime: 'Signed up in the selected period and is not Loyal',
  active: 'Known user active in the selected period, excluding Loyal and First-time',
  guest: 'Anonymous session with no userId',
};

function round1(value) {
  return Number((Number(value) || 0).toFixed(1));
}

function pct(part, total) {
  return total > 0 ? round1((part / total) * 100) : 0;
}

function previousWindow(start, end) {
  const span = Math.max(0, end.getTime() - start.getTime());
  return {
    start: new Date(start.getTime() - span),
    end: new Date(start.getTime()),
  };
}

function startOfTrendWindow(end, months = 6) {
  const anchor = new Date(end);
  anchor.setUTCHours(0, 0, 0, 0);
  anchor.setUTCDate(1);
  anchor.setUTCMonth(anchor.getUTCMonth() - (months - 1));
  return anchor;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date) {
  return date.toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
}

function buildMonthAxis(start, count = 6) {
  const axis = [];
  const cursor = new Date(start);

  for (let index = 0; index < count; index += 1) {
    axis.push({
      key: monthKey(cursor),
      label: monthLabel(cursor),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return axis;
}

/**
 * Resolve mutually-exclusive persona ID sets for a reporting window while
 * reusing the lifetime loyal cohort. This avoids recomputing loyal users for
 * current, previous and six-month trend windows.
 */
async function resolvePersonaSets(projectId, start, end, loyalIds) {
  const rows = await Event.aggregate([
    {
      $match: {
        projectId,
        timestamp: { $gte: start, $lt: end },
        userId: { $ne: null },
      },
    },
    {
      $group: {
        _id: '$userId',
        signedUp: {
          $max: {
            $cond: [{ $eq: ['$event', 'sign_up'] }, 1, 0],
          },
        },
      },
    },
  ]);

  const firsttimeIds = new Set();
  const activeIds = new Set();

  for (const row of rows) {
    const id = row._id;
    if (!id || loyalIds.has(id)) continue;

    if (row.signedUp) firsttimeIds.add(id);
    else activeIds.add(id);
  }

  return {
    loyalIds,
    firsttimeIds,
    activeIds,
  };
}

function personaSwitch(sets) {
  const loyal = [...sets.loyalIds];
  const firsttime = [...sets.firsttimeIds];
  const active = [...sets.activeIds];

  return {
    $switch: {
      branches: [
        {
          case: { $eq: ['$userId', null] },
          then: 'guest',
        },
        {
          case: { $in: ['$userId', loyal] },
          then: 'loyal',
        },
        {
          case: { $in: ['$userId', firsttime] },
          then: 'firsttime',
        },
        {
          case: { $in: ['$userId', active] },
          then: 'active',
        },
      ],
      // Every known user with activity in the window should already be in one
      // of the three sets. Keep this fallback defensive rather than dropping
      // their events if an old/odd record slips through.
      default: 'active',
    },
  };
}

function surfaceSwitch() {
  return {
    $switch: {
      branches: [
        {
          case: { $eq: ['$deviceInfo.deviceType', 'Desktop'] },
          then: 'web',
        },
        {
          case: {
            $in: ['$deviceInfo.deviceType', ['Mobile', 'Tablet']],
          },
          then: 'app',
        },
      ],
      default: 'unknown',
    },
  };
}

async function getWindowMetrics({
  projectId,
  start,
  end,
  platform,
  device,
  personaSets,
}) {
  const match = {
    projectId,
    timestamp: { $gte: start, $lt: end },
  };

  applyPlatformDeviceFilter(match, platform, device);

  const [result] = await Event.aggregate([
    { $match: match },
    {
      $set: {
        __persona: personaSwitch(personaSets),
        __surface: surfaceSwitch(),
      },
    },
    {
      $facet: {
        audience: [
          {
            $set: {
              __actor: {
                $cond: [
                  { $eq: ['$__persona', 'guest'] },
                  '$sessionId',
                  '$userId',
                ],
              },
            },
          },
          {
            $group: {
              _id: {
                persona: '$__persona',
                actor: '$__actor',
              },
            },
          },
          {
            $group: {
              _id: '$_id.persona',
              count: { $sum: 1 },
            },
          },
        ],

        sessions: [
          {
            $group: {
              _id: {
                persona: '$__persona',
                sessionId: '$sessionId',
              },
            },
          },
          {
            $group: {
              _id: '$_id.persona',
              count: { $sum: 1 },
            },
          },
        ],

        purchases: [
          { $match: { event: 'purchase' } },
          {
            $group: {
              _id: '$__persona',
              orders: { $sum: 1 },
              convertedSessions: { $addToSet: '$sessionId' },
              revenue: {
                $sum: {
                  $convert: {
                    input: '$properties.total',
                    to: 'double',
                    onError: 0,
                    onNull: 0,
                  },
                },
              },
            },
          },
          {
            $project: {
              orders: 1,
              revenue: 1,
              convertedSessions: { $size: '$convertedSessions' },
            },
          },
        ],

        repeatKnownUsers: [
          { $match: { userId: { $ne: null } } },
          {
            $group: {
              _id: {
                persona: '$__persona',
                userId: '$userId',
              },
              sessions: { $addToSet: '$sessionId' },
            },
          },
          {
            $project: {
              persona: '$_id.persona',
              isRepeat: { $gte: [{ $size: '$sessions' }, 2] },
            },
          },
          {
            $group: {
              _id: '$persona',
              totalUsers: { $sum: 1 },
              repeatUsers: {
                $sum: { $cond: ['$isRepeat', 1, 0] },
              },
            },
          },
        ],

        platformSessions: [
          { $match: { __surface: { $ne: 'unknown' } } },
          {
            $group: {
              _id: {
                persona: '$__persona',
                surface: '$__surface',
                sessionId: '$sessionId',
              },
            },
          },
          {
            $group: {
              _id: {
                persona: '$_id.persona',
                surface: '$_id.surface',
              },
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);

  const audience = new Map((result?.audience || []).map((row) => [row._id, row.count]));
  const sessions = new Map((result?.sessions || []).map((row) => [row._id, row.count]));
  const purchases = new Map((result?.purchases || []).map((row) => [row._id, row]));
  const repeat = new Map((result?.repeatKnownUsers || []).map((row) => [row._id, row]));

  const platformMap = {};
  for (const row of result?.platformSessions || []) {
    const persona = row._id?.persona;
    const surface = row._id?.surface;
    if (!persona || !surface) continue;
    platformMap[persona] = platformMap[persona] || { web: 0, app: 0 };
    platformMap[persona][surface] = row.count || 0;
  }

  const rows = {};
  let totalSessions = 0;

  for (const key of PERSONA_KEYS) {
    const sessionCount = sessions.get(key) || 0;
    totalSessions += sessionCount;

    const purchase = purchases.get(key) || {};
    const repeatRow = repeat.get(key) || {};
    const split = platformMap[key] || { web: 0, app: 0 };
    const splitTotal = split.web + split.app;

    rows[key] = {
      audienceCount: audience.get(key) || 0,
      sessionCount,
      orders: purchase.orders || 0,
      revenue: purchase.revenue || 0,
      aov: purchase.orders
        ? Math.round((purchase.revenue || 0) / purchase.orders)
        : 0,
      conversionRate: pct(purchase.convertedSessions || 0, sessionCount),
      // This is intentionally named repeatRate instead of "retention". True
      // 30-day retention is cohort-based; here we measure users with 2+ unique
      // sessions inside the selected reporting window.
      repeatRate:
        key === 'guest'
          ? null
          : pct(repeatRow.repeatUsers || 0, repeatRow.totalUsers || 0),
      platformSplit: {
        web: pct(split.web, splitTotal),
        app: pct(split.app, splitTotal),
      },
    };
  }

  for (const key of PERSONA_KEYS) {
    rows[key].trafficSharePct = pct(rows[key].sessionCount, totalSessions);
  }

  return {
    rows,
    totalSessions,
  };
}

async function getTrend({
  projectId,
  start,
  end,
  platform,
  device,
  personaSets,
}) {
  const match = {
    projectId,
    timestamp: { $gte: start, $lt: end },
  };
  applyPlatformDeviceFilter(match, platform, device);

  return Event.aggregate([
    { $match: match },
    {
      $set: {
        __persona: personaSwitch(personaSets),
        __month: {
          $dateToString: {
            format: '%Y-%m',
            date: '$timestamp',
          },
        },
      },
    },
    {
      $group: {
        _id: {
          persona: '$__persona',
          month: '$__month',
          sessionId: '$sessionId',
        },
      },
    },
    {
      $group: {
        _id: {
          persona: '$_id.persona',
          month: '$_id.month',
        },
        sessions: { $sum: 1 },
      },
    },
  ]);
}

function changePct(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return round1(((current - previous) / previous) * 100);
}

async function getPersonaExplorerOverview({
  projectId,
  period = '30d',
  customRange,
  platform = 'combined',
  device,
}) {
  if (!projectId) throw new Error('projectId is required');

  const { start, end } = resolveDateRange(period, customRange);
  const previous = previousWindow(start, end);
  const trendStart = startOfTrendWindow(end, 6);
  const trendEnd = end;
  const months = buildMonthAxis(trendStart, 6);

  // Loyalty is lifetime by product definition, so compute it once and reuse it
  // across all windows for this request.
  const loyalIds = await getLoyalUserIds(projectId);

  const [currentSets, previousSets, trendSets] = await Promise.all([
    resolvePersonaSets(projectId, start, end, loyalIds),
    resolvePersonaSets(projectId, previous.start, previous.end, loyalIds),
    resolvePersonaSets(projectId, trendStart, trendEnd, loyalIds),
  ]);

  const [currentMetrics, previousMetrics, trendRows] = await Promise.all([
    getWindowMetrics({
      projectId,
      start,
      end,
      platform,
      device,
      personaSets: currentSets,
    }),
    getWindowMetrics({
      projectId,
      start: previous.start,
      end: previous.end,
      platform,
      device,
      personaSets: previousSets,
    }),
    getTrend({
      projectId,
      start: trendStart,
      end: trendEnd,
      platform,
      device,
      personaSets: trendSets,
    }),
  ]);

  const trendLookup = {};
  for (const row of trendRows) {
    const persona = row._id?.persona;
    const month = row._id?.month;
    if (!persona || !month) continue;
    trendLookup[persona] = trendLookup[persona] || {};
    trendLookup[persona][month] = row.sessions || 0;
  }

  const personas = PERSONA_KEYS.map((id) => {
    const current = currentMetrics.rows[id];
    const prev = previousMetrics.rows[id];

    return {
      id,
      criteria: PERSONA_RULES[id],
      audienceCount: current.audienceCount,
      sessionCount: current.sessionCount,
      trafficSharePct: current.trafficSharePct,
      audienceChangePct: changePct(current.audienceCount, prev.audienceCount),
      revenue: round1(current.revenue),
      orders: current.orders,
      aov: current.aov,
      conversionRate: current.conversionRate,
      repeatRate: current.repeatRate,
      platformSplit: current.platformSplit,
      trend: months.map((month) => ({
        key: month.key,
        label: month.label,
        value: trendLookup[id]?.[month.key] || 0,
      })),
    };
  });

  return {
    range: {
      start,
      end,
    },
    platform,
    device: device || null,
    summary: {
      totalSessions: currentMetrics.totalSessions,
      personaCount: PERSONA_KEYS.length,
    },
    months,
    personas,
  };
}

module.exports = {
  getPersonaExplorerOverview,
  PERSONA_KEYS,
};
