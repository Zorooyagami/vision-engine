/**
 * Stats Controller
 * ----------------
 * This is where dashboard-facing endpoints live. Starting with just
 * the funnel today — segmentation, anomaly detection, and AI summary
 * endpoints will get their own functions here as we build them
 * (Days 7-11 in the plan).
 */

const { getFunnel, getLoyalCustomer, getGamers, getUsersByPeriod } = require("../services/funnelService");

/**
 * GET /api/stats/funnel
 * Optional query params: startDate, endDate, deviceType, trafficSource
 */
async function funnel(req, res) {
  try {
    const { startDate, endDate, deviceType, trafficSource } = req.query;

    const data = await getFunnel({ startDate, endDate, deviceType, trafficSource });

    return res.json({ funnel: data });
  } catch (err) {
    console.error("[stats] funnel error:", err.message);
    return res.status(500).json({ error: "failed to compute funnel" });
  }
}

const personas = async (req, res) => {
  try {
    // Placeholder for personas logic
    const { startDate, endDate, deviceType, trafficSource } = req.query;

    // const loyalUsersPersona = await getLoyalCustomer({ startDate, endDate, deviceType, trafficSource });

    // const gamers = await getGamers({ startDate, endDate, deviceType, trafficSource });

    const users = await getUsersByPeriod(req.query.period)
    return res.json({ message: "Personas endpoint is under construction.", data: [
    //   {
    //   persona: "Loyal Customers",
    //   description: "Users who have made multiple purchases and show high engagement.",
    //   records: loyalUsersPersona[0],
    // },
     {
      persona: "User",
      description: "Users who frequently signed up.",
      records: users,
    },] });
  } catch (err) {
    console.error("[stats] personas error:", err.message);
    return res.status(500).json({ error: "failed to compute personas" });
  }
}

async function getAbandonedSessions(req, res) {
  try {
    const sessions = await Event.aggregate([
      { $match: { event: { $in: ['add_to_cart', 'purchase'] } } },
      {
        $group: {
          _id: '$sessionId',
          userId: { $first: '$userId' },
          hasAddToCart: { $max: { $cond: [{ $eq: ['$event', 'add_to_cart'] }, 1, 0] } },
          hasPurchase: { $max: { $cond: [{ $eq: ['$event', 'purchase'] }, 1, 0] } },
          lastActivity: { $max: '$timestamp' },
        },
      },
      { $match: { hasAddToCart: 1, hasPurchase: 0 } },
      { $sort: { lastActivity: -1 } },
      { $limit: 100 },
    ])

    res.json(
      sessions.map((s) => ({
        sessionId: s._id,
        userId: s.userId,
        lastActivity: s.lastActivity,
      }))
    )
  } catch (err) {
    console.error('[analytics/abandoned-sessions] failed:', err.message)
    res.status(500).json({ error: 'Failed to fetch abandoned sessions' })
  }
}

// server/controllers/analyticsController.js
const Event = require('../models/Event')

async function getCartAbandonmentFunnel(req, res) {
  try {
    const sessions = await Event.aggregate([
      { $match: { event: { $in: ['add_to_cart', 'view_cart', 'checkout_start', 'shipping_details', 'purchase'] } } },
      {
        $group: {
          _id: '$sessionId',
          userId: { $first: '$userId' },
          events: { $addToSet: '$event' },
        },
      },
    ])

    const funnel = {
      addedToCart: 0,
      viewedCart: 0,
      startedCheckout: 0,
      enteredShipping: 0,
      purchased: 0,
    }

    sessions.forEach((s) => {
      if (s.events.includes('add_to_cart')) funnel.addedToCart++
      if (s.events.includes('view_cart')) funnel.viewedCart++
      if (s.events.includes('checkout_start')) funnel.startedCheckout++
      if (s.events.includes('shipping_details')) funnel.enteredShipping++
      if (s.events.includes('purchase')) funnel.purchased++
    })

    const abandonedAfterAddToCart = funnel.addedToCart - funnel.purchased

    res.json({
      funnel,
      abandonedAfterAddToCart,
      abandonmentRate: funnel.addedToCart > 0
        ? ((abandonedAfterAddToCart / funnel.addedToCart) * 100).toFixed(1) + '%'
        : '0%',
    })
  } catch (err) {
    console.error('[analytics/abandonment] failed:', err.message)
    res.status(500).json({ error: 'Failed to compute abandonment funnel' })
  }
}


async function getEventBreakdown(req, res) {
  try {
    const breakdown = await Event.aggregate([
      {
        $group: {
          _id: '$event',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ])

    const totalEvents = breakdown.reduce((sum, e) => sum + e.count, 0)

    const result = breakdown.map((e) => ({
      event: e._id,
      count: e.count,
      percentage: totalEvents > 0
        ? Number(((e.count / totalEvents) * 100).toFixed(2))
        : 0,
    }))

    res.json({
      totalEvents,
      breakdown: result,
    })
  } catch (err) {
    console.error('[analytics/events] failed:', err.message)
    res.status(500).json({ error: 'Failed to compute event breakdown' })
  }
}

async function getPageViews(req, res) {
  try {
    const pages = await Event.aggregate([
      {
        $match: {
          event: 'page_view',
          path: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: {
            $cond: [
              {
                $regexMatch: {
                  input: "$path",
                  regex: "^/products-detail",
                },
              },
              "/products-detail",
              "$path",
            ],
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: {
          count: -1,
        },
      },
    ]);

    const totalViews = pages.reduce(
      (sum, page) => sum + page.count,
      0
    );

    const result = pages.map((page) => ({
      page: page._id,
      count: page.count,
      percentage:
        totalViews > 0
          ? Number(((page.count / totalViews) * 100).toFixed(2))
          : 0,
    }));

    res.json({
      totalViews,
      pages: result,
    });
  } catch (err) {
    console.error('[analytics/pageviews] failed:', err);

    res.status(500).json({
      error: 'Failed to compute page views',
    });
  }
}


// each journey = an ordered list of steps; a session "matches" if its
// events contain this subsequence in order (other events can appear in between)
const JOURNEY_DEFINITIONS = {
  home_direct_add: {
    label: 'Home → add to cart → view cart → checkout',
    steps: [
      { event: 'page_view', path: '/' },
      { event: 'add_to_cart', path: '/' },
      { event: 'view_cart', path: '/cart' },
      { event: 'checkout_start', path: '/shipping-info' },
    ],
  },
  plp_direct_add: {
    label: 'Products page → add to cart → view cart → checkout',
    steps: [
      { event: 'page_view', path: '/products' },
      { event: 'add_to_cart', pathTest: (p) => p === '/products' },
      { event: 'view_cart', path: '/cart' },
      { event: 'checkout_start', path: '/shipping-info' },
    ],
  },
  full_pdp_funnel: {
    label: 'Home → products → product detail → add to cart → view cart → checkout',
    steps: [
      { event: 'page_view', path: '/' },
      { event: 'page_view', path: '/products' },
      { event: 'page_view', pathTest: (p) => p.startsWith('/products-detail/') },
      { event: 'add_to_cart', pathTest: (p) => p.startsWith('/products-detail/') },
      { event: 'view_cart', path: '/cart' },
      { event: 'checkout_start', path: '/shipping-info' },
    ],
  },
}

function matchesJourney(sessionEvents, steps) {
  let stepIndex = 0
  for (const ev of sessionEvents) {
    const step = steps[stepIndex]
    const pathMatches = step.path ? ev.path === step.path : step.pathTest(ev.path)
    if (ev.event === step.event && pathMatches) {
      stepIndex++
      if (stepIndex === steps.length) return true
    }
  }
  return false
}

async function getJourneyCounts(req, res) {
  try {
    const sessions = await Event.aggregate([
      { $sort: { sessionId: 1, timestamp: 1 } },
      {
        $group: {
          _id: '$sessionId',
          userId: { $first: '$userId' },
          events: { $push: { event: '$event', path: '$path' } },
        },
      },
    ])

    const results = {}
    for (const [key, def] of Object.entries(JOURNEY_DEFINITIONS)) {
      const matchedSessions = sessions.filter((s) => matchesJourney(s.events, def.steps))
      results[key] = {
        label: def.label,
        sessionCount: matchedSessions.length,
        percentOfAllSessions: sessions.length > 0
          ? Number(((matchedSessions.length / sessions.length) * 100).toFixed(2))
          : 0,
        sampleSessionIds: matchedSessions.slice(0, 5).map((s) => s._id), // handy for replay lookup
      }
    }

    res.json({ totalSessions: sessions.length, journeys: results })
  } catch (err) {
    console.error('[analytics/journeys] failed:', err.message)
    res.status(500).json({ error: 'Failed to compute journey counts' })
  }
}

// server/controllers/analyticsController.js
async function getExitEvents(req, res) {
  try {
    const sessions = await Event.aggregate([
      { $sort: { sessionId: 1, timestamp: 1 } },
      {
        $group: {
          _id: '$sessionId',
          userId: { $first: '$userId' },
          lastEvent: { $last: '$event' },
          lastPath: { $last: '$path' },
          lastTimestamp: { $last: '$timestamp' },
        },
      },
    ])

    const exitCounts = {} // event name -> count of sessions that ended there
    sessions.forEach((s) => {
      exitCounts[s.lastEvent] = (exitCounts[s.lastEvent] || 0) + 1
    })

    const totalSessions = sessions.length
    const breakdown = Object.entries(exitCounts)
      .map(([event, count]) => ({
        event,
        count,
        exitRate: Number(((count / totalSessions) * 100).toFixed(2)),
      }))
      .sort((a, b) => b.count - a.count)

    res.json({ totalSessions, exitPoints: breakdown })
  } catch (err) {
    console.error('[analytics/exit-points] failed:', err.message)
    res.status(500).json({ error: 'Failed to compute exit points' })
  }
}

async function getExitPages(req, res) {
  try {
    // only look at page_view events — the last one per session tells you
    // which page they were physically on when the session ended
    const sessions = await Event.aggregate([
      { $match: { event: 'page_view' } },
      { $sort: { sessionId: 1, timestamp: 1 } },
      { $group: { _id: '$sessionId', lastPath: { $last: '$path' } } },
    ])

    const normalized = {}
    sessions.forEach((s) => {
      const path = s.lastPath.startsWith('/products-detail/') ? '/products-detail/:id' : s.lastPath
      normalized[path] = (normalized[path] || 0) + 1
    })

    const totalSessions = sessions.length
    const breakdown = Object.entries(normalized)
      .map(([path, count]) => ({
        path,
        count,
        exitRate: Number(((count / totalSessions) * 100).toFixed(2)),
      }))
      .sort((a, b) => b.count - a.count)

    res.json({ totalSessions, exitPages: breakdown })
  } catch (err) {
    console.error('[analytics/exit-pages] failed:', err.message)
    res.status(500).json({ error: 'Failed to compute exit pages' })
  }
}

// =====================================================================
// period parsing
// =====================================================================
function getPeriodRange(period) {
  if (!period || period === 'all') return null
  const to = new Date()
  const from = new Date(to)
  const map = { '1d': 1, '1w': 7, '1m': 30, '3m': 90, '6m': 180 }
  const days = map[period]
  if (!days) throw new Error(`invalid period: ${period}`)
  from.setDate(from.getDate() - days)
  return { from, to }
}

// =====================================================================
// GET /api/analytics/user-segments?period=1w
// =====================================================================
async function getUserSegments(req, res) {
  try {
    const period = req.query.period || 'all'
    const range = getPeriodRange(period)
    const periodMatch = range ? { timestamp: { $gte: range.from, $lte: range.to } } : {}

    // --- lifetime purchase counts, used to define "loyal" regardless of period ---
    const lifetimePurchases = await Event.aggregate([
      { $match: { event: 'purchase' } },
      { $group: { _id: '$userId', purchaseCount: { $sum: 1 } } },
    ])
    const loyalUserIds = new Set(
      lifetimePurchases.filter((u) => u.purchaseCount >= 2).map((u) => u._id)
    )

    // --- earliest sign_up per user, used to define "first time" within the period ---
    const signups = await Event.aggregate([
      { $match: { event: 'sign_up' } },
      { $group: { _id: '$userId', signupAt: { $min: '$timestamp' } } },
    ])
    const signupMap = new Map(signups.map((s) => [s._id, s.signupAt]))

    // --- all events within the period, grouped per user ---
    const perUser = await Event.aggregate([
      { $match: periodMatch },
      {
        $group: {
          _id: '$userId',
          sessionIds: { $addToSet: '$sessionId' },
          purchaseEvents: {
            $push: {
              $cond: [{ $eq: ['$event', 'purchase'] }, '$properties.total', '$$REMOVE'],
            },
          },
        },
      },
    ])

    // --- bucket users into segments ---
    const activeIds = []
    const loyalIds = []
    const firstTimeIds = []

    perUser.forEach((u) => {
      activeIds.push(u._id)
      if (loyalUserIds.has(u._id)) loyalIds.push(u._id)

      const signupAt = signupMap.get(u._id)
      const inPeriod = signupAt && (!range || (signupAt >= range.from && signupAt <= range.to))
      if (inPeriod) firstTimeIds.push(u._id)
    })

    // --- guest: events in period with NO matching User account at all ---

    // --- guest events: no userId at all ---
    const guestMatch = { ...periodMatch, userId: null }
    const guestSessions = await Event.aggregate([
      { $match: guestMatch },
      {
        $group: {
          _id: '$sessionId', // group by session, not userId, since there's no userId to group by
          purchaseEvents: {
            $push: {
              $cond: [{ $eq: ['$event', 'purchase'] }, '$properties.total', '$$REMOVE'],
            },
          },
        },
      },
    ])

    let guestPurchaseCount = 0
    let guestRevenue = 0
    guestSessions.forEach((s) => {
      s.purchaseEvents.forEach((totalStr) => {
        guestPurchaseCount++
        guestRevenue += parseFloat(totalStr) || 0
      })
    })

    const guestMetrics = {
      sessionCount: guestSessions.length,
      purchaseCount: guestPurchaseCount,
      revenue: Number(guestRevenue.toFixed(2)),
      avgOrderValue: guestPurchaseCount > 0
        ? Number((guestRevenue / guestPurchaseCount).toFixed(2))
        : 0,
      conversionRate: guestSessions.length > 0
        ? Number(((guestPurchaseCount / guestSessions.length) * 100).toFixed(2))
        : 0,
    }
    // (currently will always be empty — see note above)
    const knownUserIds = new Set(perUser.map((u) => u._id))
    // placeholder — populate once anonymous/pre-login events exist in the schema
    const guestIds = []

    function metricsFor(userIdList) {
      const idSet = new Set(userIdList)
      const rows = perUser.filter((u) => idSet.has(u._id))

      let sessionCount = 0
      let purchaseCount = 0
      let revenue = 0

      rows.forEach((r) => {
        sessionCount += r.sessionIds.length
        r.purchaseEvents.forEach((totalStr) => {
          purchaseCount++
          revenue += parseFloat(totalStr) || 0
        })
      })

      return {
        userCount: userIdList.length,
        sessionCount,
        purchaseCount,
        revenue: Number(revenue.toFixed(2)),
        avgOrderValue: purchaseCount > 0 ? Number((revenue / purchaseCount).toFixed(2)) : 0,
        conversionRate: sessionCount > 0
          ? Number(((purchaseCount / sessionCount) * 100).toFixed(2))
          : 0,
      }
    }

    res.json({
      period,
      range: range || 'all-time',
      segments: {
        active: metricsFor(activeIds),
        loyal: metricsFor(loyalIds),
        firstTime: metricsFor(firstTimeIds),
        guest: guestMetrics,
      },
    })
  } catch (err) {
    console.error('[analytics/user-segments] failed:', err.message)
    res.status(400).json({ error: err.message })
  }
}
module.exports = { funnel, personas, getAbandonedSessions, getCartAbandonmentFunnel, getEventBreakdown, getPageViews, getJourneyCounts,
  getExitEvents, getExitPages, getUserSegments
 };

/*
for personas will he have time filters? like 1 day? 1 week? 1 month?


*/