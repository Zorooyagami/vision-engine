const Event = require('../models/Event');
const { getFunnel, getUsersByPeriod } = require('../services/funnelService');

async function funnel(req, res) {
  try {
    const { startDate, endDate, deviceType, trafficSource } = req.query;
    const data = await getFunnel({
      projectId: req.projectId,
      startDate,
      endDate,
      deviceType,
      trafficSource,
    });
    res.json({ funnel: data });
  } catch (err) {
    console.error('[stats] funnel error:', err.message);
    res.status(500).json({ error: 'failed to compute funnel' });
  }
}

async function personas(req, res) {
  try {
    const users = await getUsersByPeriod(req.projectId, req.query.period || '1m');
    res.json({
      message: 'Personas endpoint is under construction.',
      data: [{ persona: 'User', description: 'Users who frequently signed up.', records: users }],
    });
  } catch (err) {
    console.error('[stats] personas error:', err.message);
    res.status(500).json({ error: 'failed to compute personas' });
  }
}

async function getAbandonedSessions(req, res) {
  try {
    const sessions = await Event.aggregate([
      { $match: { projectId: req.projectId, event: { $in: ['add_to_cart', 'purchase'] } } },
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
    ]);
    res.json(sessions.map((row) => ({ sessionId: row._id, userId: row.userId, lastActivity: row.lastActivity })));
  } catch (err) {
    console.error('[analytics/abandoned-sessions] failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch abandoned sessions' });
  }
}

async function getCartAbandonmentFunnel(req, res) {
  try {
    const sessions = await Event.aggregate([
      {
        $match: {
          projectId: req.projectId,
          event: { $in: ['add_to_cart', 'view_cart', 'checkout_start', 'shipping_details', 'purchase'] },
        },
      },
      { $group: { _id: '$sessionId', events: { $addToSet: '$event' } } },
    ]);

    const result = { addedToCart: 0, viewedCart: 0, startedCheckout: 0, enteredShipping: 0, purchased: 0 };
    sessions.forEach((session) => {
      if (session.events.includes('add_to_cart')) result.addedToCart += 1;
      if (session.events.includes('view_cart')) result.viewedCart += 1;
      if (session.events.includes('checkout_start')) result.startedCheckout += 1;
      if (session.events.includes('shipping_details')) result.enteredShipping += 1;
      if (session.events.includes('purchase')) result.purchased += 1;
    });

    const abandonedAfterAddToCart = result.addedToCart - result.purchased;
    res.json({
      funnel: result,
      abandonedAfterAddToCart,
      abandonmentRate: result.addedToCart
        ? `${((abandonedAfterAddToCart / result.addedToCart) * 100).toFixed(1)}%`
        : '0%',
    });
  } catch (err) {
    console.error('[analytics/abandonment] failed:', err.message);
    res.status(500).json({ error: 'Failed to compute abandonment funnel' });
  }
}

async function getEventBreakdown(req, res) {
  try {
    const breakdown = await Event.aggregate([
      { $match: { projectId: req.projectId } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const totalEvents = breakdown.reduce((sum, row) => sum + row.count, 0);
    res.json({
      totalEvents,
      breakdown: breakdown.map((row) => ({
        event: row._id,
        count: row.count,
        percentage: totalEvents ? Number(((row.count / totalEvents) * 100).toFixed(2)) : 0,
      })),
    });
  } catch (err) {
    console.error('[analytics/events] failed:', err.message);
    res.status(500).json({ error: 'Failed to compute event breakdown' });
  }
}

async function getPageViews(req, res) {
  try {
    const pages = await Event.aggregate([
      {
        $match: {
          projectId: req.projectId,
          event: 'page_view',
          path: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: {
            $cond: [
              { $regexMatch: { input: '$path', regex: '^/products-detail' } },
              '/products-detail',
              '$path',
            ],
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);
    const totalViews = pages.reduce((sum, row) => sum + row.count, 0);
    res.json({
      totalViews,
      pages: pages.map((row) => ({
        page: row._id,
        count: row.count,
        percentage: totalViews ? Number(((row.count / totalViews) * 100).toFixed(2)) : 0,
      })),
    });
  } catch (err) {
    console.error('[analytics/pageviews] failed:', err);
    res.status(500).json({ error: 'Failed to compute page views' });
  }
}

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
      { event: 'add_to_cart', pathTest: (path) => path === '/products' },
      { event: 'view_cart', path: '/cart' },
      { event: 'checkout_start', path: '/shipping-info' },
    ],
  },
  full_pdp_funnel: {
    label: 'Home → products → product detail → add to cart → view cart → checkout',
    steps: [
      { event: 'page_view', path: '/' },
      { event: 'page_view', path: '/products' },
      { event: 'page_view', pathTest: (path) => path?.startsWith('/products-detail/') },
      { event: 'add_to_cart', pathTest: (path) => path?.startsWith('/products-detail/') },
      { event: 'view_cart', path: '/cart' },
      { event: 'checkout_start', path: '/shipping-info' },
    ],
  },
};

function matchesJourney(sessionEvents, steps) {
  let stepIndex = 0;
  for (const event of sessionEvents) {
    const step = steps[stepIndex];
    const pathMatches = step.path ? event.path === step.path : step.pathTest?.(event.path);
    if (event.event === step.event && pathMatches) {
      stepIndex += 1;
      if (stepIndex === steps.length) return true;
    }
  }
  return false;
}

async function getJourneyCounts(req, res) {
  try {
    const sessions = await Event.aggregate([
      { $match: { projectId: req.projectId } },
      { $sort: { sessionId: 1, timestamp: 1 } },
      {
        $group: {
          _id: '$sessionId',
          events: { $push: { event: '$event', path: '$path', timestamp: '$timestamp' } },
        },
      },
    ]);

    const journeys = {};
    for (const [key, definition] of Object.entries(JOURNEY_DEFINITIONS)) {
      const matched = sessions.filter((session) => matchesJourney(session.events, definition.steps));
      journeys[key] = {
        label: definition.label,
        sessionCount: matched.length,
        percentOfAllSessions: sessions.length
          ? Number(((matched.length / sessions.length) * 100).toFixed(2))
          : 0,
        sampleSessionIds: matched.slice(0, 5).map((session) => session._id),
      };
    }
    res.json({ totalSessions: sessions.length, journeys });
  } catch (err) {
    console.error('[analytics/journeys] failed:', err.message);
    res.status(500).json({ error: 'Failed to compute journey counts' });
  }
}

async function getExitEvents(req, res) {
  try {
    const sessions = await Event.aggregate([
      { $match: { projectId: req.projectId } },
      { $sort: { sessionId: 1, timestamp: 1 } },
      { $group: { _id: '$sessionId', lastEvent: { $last: '$event' } } },
    ]);
    const counts = {};
    sessions.forEach((session) => { counts[session.lastEvent] = (counts[session.lastEvent] || 0) + 1; });
    const totalSessions = sessions.length;
    res.json({
      totalSessions,
      exitPoints: Object.entries(counts)
        .map(([event, count]) => ({ event, count, exitRate: totalSessions ? Number(((count / totalSessions) * 100).toFixed(2)) : 0 }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (err) {
    console.error('[analytics/exit-points] failed:', err.message);
    res.status(500).json({ error: 'Failed to compute exit points' });
  }
}

async function getExitPages(req, res) {
  try {
    const sessions = await Event.aggregate([
      { $match: { projectId: req.projectId, event: 'page_view' } },
      { $sort: { sessionId: 1, timestamp: 1 } },
      { $group: { _id: '$sessionId', lastPath: { $last: '$path' } } },
    ]);
    const normalized = {};
    sessions.forEach((session) => {
      if (!session.lastPath) return;
      const path = session.lastPath.startsWith('/products-detail/') ? '/products-detail/:id' : session.lastPath;
      normalized[path] = (normalized[path] || 0) + 1;
    });
    const totalSessions = sessions.length;
    res.json({
      totalSessions,
      exitPages: Object.entries(normalized)
        .map(([path, count]) => ({ path, count, exitRate: totalSessions ? Number(((count / totalSessions) * 100).toFixed(2)) : 0 }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (err) {
    console.error('[analytics/exit-pages] failed:', err.message);
    res.status(500).json({ error: 'Failed to compute exit pages' });
  }
}

function getPeriodRange(period) {
  if (!period || period === 'all') return null;
  const to = new Date();
  const from = new Date(to);
  const map = { '1d': 1, '1w': 7, '1m': 30, '3m': 90, '6m': 180 };
  if (!map[period]) throw new Error(`invalid period: ${period}`);
  from.setDate(from.getDate() - map[period]);
  return { from, to };
}

async function getUserSegments(req, res) {
  try {
    const period = req.query.period || 'all';
    const range = getPeriodRange(period);
    const periodMatch = {
      projectId: req.projectId,
      ...(range ? { timestamp: { $gte: range.from, $lte: range.to } } : {}),
    };

    const [lifetimePurchases, signups, perUser, guestSessions] = await Promise.all([
      Event.aggregate([
        { $match: { projectId: req.projectId, event: 'purchase', userId: { $ne: null } } },
        { $group: { _id: '$userId', purchaseCount: { $sum: 1 } } },
      ]),
      Event.aggregate([
        { $match: { projectId: req.projectId, event: 'sign_up', userId: { $ne: null } } },
        { $group: { _id: '$userId', signupAt: { $min: '$timestamp' } } },
      ]),
      Event.aggregate([
        { $match: { ...periodMatch, userId: { $ne: null } } },
        {
          $group: {
            _id: '$userId',
            sessionIds: { $addToSet: '$sessionId' },
            purchaseEvents: {
              $push: { $cond: [{ $eq: ['$event', 'purchase'] }, '$properties.total', '$$REMOVE'] },
            },
          },
        },
      ]),
      Event.aggregate([
        { $match: { ...periodMatch, userId: null } },
        {
          $group: {
            _id: '$sessionId',
            purchaseEvents: {
              $push: { $cond: [{ $eq: ['$event', 'purchase'] }, '$properties.total', '$$REMOVE'] },
            },
          },
        },
      ]),
    ]);

    const loyalSet = new Set(lifetimePurchases.filter((row) => row.purchaseCount >= 2).map((row) => row._id));
    const signupMap = new Map(signups.map((row) => [row._id, row.signupAt]));
    const activeIds = [];
    const loyalIds = [];
    const firstTimeIds = [];

    perUser.forEach((user) => {
      // Keep personas mutually exclusive and consistent with the rest of the
      // dashboard: loyal > first-time > active. Any known user with activity
      // in the period who is not loyal/first-time is active.
      if (loyalSet.has(user._id)) {
        loyalIds.push(user._id);
        return;
      }

      const signupAt = signupMap.get(user._id);
      if (signupAt && (!range || (signupAt >= range.from && signupAt <= range.to))) {
        firstTimeIds.push(user._id);
        return;
      }

      activeIds.push(user._id);
    });

    function metricsFor(ids) {
      const set = new Set(ids);
      const rows = perUser.filter((row) => set.has(row._id));
      let sessionCount = 0;
      let purchaseCount = 0;
      let revenue = 0;
      rows.forEach((row) => {
        sessionCount += row.sessionIds.length;
        row.purchaseEvents.forEach((value) => { purchaseCount += 1; revenue += Number(value) || 0; });
      });
      return {
        userCount: ids.length,
        sessionCount,
        purchaseCount,
        revenue: Number(revenue.toFixed(2)),
        avgOrderValue: purchaseCount ? Number((revenue / purchaseCount).toFixed(2)) : 0,
        conversionRate: sessionCount ? Number(((purchaseCount / sessionCount) * 100).toFixed(2)) : 0,
      };
    }

    let guestPurchaseCount = 0;
    let guestRevenue = 0;
    guestSessions.forEach((session) => {
      session.purchaseEvents.forEach((value) => { guestPurchaseCount += 1; guestRevenue += Number(value) || 0; });
    });
    const guestMetrics = {
      userCount: 0,
      sessionCount: guestSessions.length,
      purchaseCount: guestPurchaseCount,
      revenue: Number(guestRevenue.toFixed(2)),
      avgOrderValue: guestPurchaseCount ? Number((guestRevenue / guestPurchaseCount).toFixed(2)) : 0,
      conversionRate: guestSessions.length ? Number(((guestPurchaseCount / guestSessions.length) * 100).toFixed(2)) : 0,
    };

    res.json({
      period,
      range: range || 'all-time',
      segments: {
        active: metricsFor(activeIds),
        loyal: metricsFor(loyalIds),
        firstTime: metricsFor(firstTimeIds),
        guest: guestMetrics,
      },
    });
  } catch (err) {
    console.error('[analytics/user-segments] failed:', err.message);
    res.status(400).json({ error: err.message });
  }
}

module.exports = {
  funnel,
  personas,
  getAbandonedSessions,
  getCartAbandonmentFunnel,
  getEventBreakdown,
  getPageViews,
  getJourneyCounts,
  getExitEvents,
  getExitPages,
  getUserSegments,
};
