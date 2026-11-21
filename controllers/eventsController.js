//controllers/eventsController.js
const Event = require('../models/Event');
const Project = require('../models/Project');
const { publishEvent } = require('../services/liveService');
const { getSdkConfig: loadSdkConfig } = require('../services/eventCatalog');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
  applyPersonaFilter,
} = require('../services/filterHelpers');

const FUNNEL_EVENTS = [
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'checkout_start',
  'purchase',
];

function validTimestamp(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) ? date : null;
}

async function ingestEvents(req, res) {
  try {
    const { events } = req.body || {};
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events must be a non-empty array' });
    }
    if (events.length > 100) {
      return res.status(400).json({ error: 'maximum 100 events per batch' });
    }

    const heatmapsEnabled = req.project?.settings?.heatmaps !== false;
    const analyticsEnabled = req.project?.settings?.analytics !== false;
    if (!analyticsEnabled && !heatmapsEnabled) {
      return res.status(403).json({ error: 'Event collection is disabled for this project' });
    }

    const ip = req.ip;
    const documents = [];
    let rejected = 0;

    for (const event of events) {
      const timestamp = event?.timestamp ? validTimestamp(event.timestamp) : null;
      const isHeatmap = event?.event === 'heatmap_click' || event?.event === 'heatmap_move';

      if (!event?.event || !event?.sessionId || !timestamp || ((isHeatmap && !heatmapsEnabled) || (!isHeatmap && !analyticsEnabled))) {
        rejected += 1;
        continue;
      }

      // projectId is always server-authoritative. A browser cannot write data
      // into another tenant by putting a different id inside an individual event.
      const { projectId: ignoredProjectId, ...safeEvent } = event;
      documents.push({
        ...safeEvent,
        projectId: req.projectId,
        userId: event.userId || null,
        ip,
        timestamp,
      });
    }

    if (!documents.length) {
      return res.status(400).json({ error: 'no valid events in payload' });
    }

    const result = await Event.insertMany(documents, { ordered: false });
    console.log(`[events] ingested ${result.length} events for project ${req.projectId}`);
    result.forEach(publishEvent);
    const lastEventAt = documents.reduce(
      (latest, event) => (event.timestamp > latest ? event.timestamp : latest),
      documents[0].timestamp
    );

    // Keep project cards cheap to render: no need to scan the events collection
    // just to know whether/when a project last sent data.
    await Project.updateOne(
      { projectId: req.projectId },
      { $max: { lastEventAt } }
    );

    return res.status(201).json({
      inserted: result.length,
      received: events.length,
      rejected,
    });
  } catch (err) {
    console.error('[events] ingest error:', err);
    return res.status(500).json({ error: 'failed to ingest events' });
  }
}

async function getRecentEvents(req, res) {
  try {
    const requested = parseInt(req.query.limit, 10);
    const limit = Math.max(1, Math.min(Number.isNaN(requested) ? 20 : requested, 100));
    const events = await Event.find({ projectId: req.projectId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    res.json({ events });
  } catch (err) {
    console.error('[events] recent fetch error:', err);
    res.status(500).json({ error: 'failed to fetch recent events' });
  }
}

async function getEventSummary(req, res) {
  try {
    const summary = await Event.aggregate([
      {
        $match: {
          projectId: req.projectId,
          event: { $in: FUNNEL_EVENTS },
        },
      },
      { $group: { _id: '$event', count: { $sum: 1 } } },
      { $project: { _id: 0, event: '$_id', count: 1 } },
      { $sort: { count: -1 } },
    ]);
    res.json({ events: summary });
  } catch (err) {
    console.error('[events] summary error:', err);
    res.status(500).json({ error: 'failed to fetch event summary' });
  }
}

async function getPageHeatmaps(req, res) {
  try {
    if (req.project?.settings?.heatmaps === false) {
      return res.json({ page: null, events: [] });
    }

    const pages = ['home', 'products', 'product_detail', 'cart'];
    const page = pages[Number(req.params.pageId)];
    if (!page) return res.status(400).json({ error: 'invalid pageId' });

    const { period = '30d', from, to, personas, platform = 'combined' } = req.query;
    const { start, end } = resolveDateRange(period, from && to ? { from, to } : null);
    const match = {
      projectId: req.projectId,
      event: { $in: ['heatmap_move', 'heatmap_click'] },
      timestamp: { $gte: start, $lt: end },
    };

    const explicitPath = req.query.path ? String(req.query.path) : null;
    if (explicitPath) {
      match.path = explicitPath;
    } else if (page === 'product_detail') {
      match.path = { $regex: '^/products-detail/' };
    } else {
      match.path = { home: '/', products: '/products', cart: '/cart' }[page];
    }

    applyPlatformDeviceFilter(
      match,
      platform,
      req.query.device || req.query.deviceType || null
    );

    const personaList = personas ? String(personas).split(',').filter(Boolean) : [];
    const personaFilter = await getPersonaUserIds(req.projectId, personaList, start, end);
    applyPersonaFilter(match, personaFilter);

    // Clicks and moves get separate caps so a flood of pointer-move samples can
    // never crowd the (much rarer, much more valuable) clicks out of the result.
    const CAPS = { heatmap_click: 50000, heatmap_move: 40000 };
    const requestedCap = parseInt(req.query.limit, 10);
    const capFor = (type) =>
      Number.isFinite(requestedCap) && requestedCap > 0 ? Math.min(requestedCap, 100000) : CAPS[type];

    // Only the fields the heatmap actually draws and filters with.
    const projection = {
      _id: 0,
      sessionId: 1,
      userId: 1,
      event: 1,
      timestamp: 1,
      path: 1,
      'deviceInfo.deviceType': 1,
      'properties.coordinateSpace': 1,
      'properties.x': 1,
      'properties.y': 1,
      'properties.xPx': 1,
      'properties.yPx': 1,
      'properties.documentWidth': 1,
      'properties.documentHeight': 1,
      'properties.viewportWidth': 1,
      'properties.viewportHeight': 1,
      'properties.scrollX': 1,
      'properties.scrollY': 1,
      'properties.target': 1,
    };

    const fetchType = async (type) => {
      const cap = capFor(type);
      // Newest first, so a truncated result is the most recent activity.
      const rows = await Event.find({ ...match, event: type })
        .select(projection)
        .sort({ timestamp: -1 })
        .limit(cap + 1)
        .maxTimeMS(30000)
        .lean();
      const truncated = rows.length > cap;
      return { rows: truncated ? rows.slice(0, cap) : rows, truncated };
    };

    const [clicks, moves] = await Promise.all([fetchType('heatmap_click'), fetchType('heatmap_move')]);
    const events = clicks.rows.concat(moves.rows);

    // Most-visited concrete paths (e.g. which product page people actually
    // looked at) so the dashboard can show the real page behind the heat.
    const pathCounts = new Map();
    for (const row of clicks.rows) {
      if (row.path) pathCounts.set(row.path, (pathCounts.get(row.path) || 0) + 1);
    }
    if (!pathCounts.size) {
      for (const row of moves.rows) {
        if (row.path) pathCounts.set(row.path, (pathCounts.get(row.path) || 0) + 1);
      }
    }
    const topPaths = Array.from(pathCounts, ([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    res.json({
      page,
      events,
      meta: {
        counts: { click: clicks.rows.length, move: moves.rows.length },
        truncated: { click: clicks.truncated, move: moves.truncated },
        topPaths,
      },
    });
  } catch (err) {
    console.error('[events] heatmap error:', err);
    res.status(500).json({ error: 'failed to fetch heatmap data' });
  }
}

// Public, read-only config for the hosted SDK: which dashboard-defined events to
// fire, and which dashboard origins may drive the on-site element picker.
async function getSdkConfig(req, res) {
  try {
    const { version, definitions } = await loadSdkConfig(req.projectId);
    const editorOrigins = String(process.env.DASHBOARD_ORIGINS || '')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean);

    res.set('Cache-Control', 'public, max-age=30');
    res.json({ version, definitions, editorOrigins, settings: {
      analytics: req.project.settings?.analytics !== false,
      heatmaps: req.project.settings?.heatmaps !== false,
      sessionReplay: req.project.settings?.sessionReplay !== false,
    } });
  } catch (err) {
    console.error('[events] sdk config error:', err);
    res.status(500).json({ error: 'failed to load sdk config' });
  }
}

module.exports = { ingestEvents, getRecentEvents, getEventSummary, getPageHeatmaps, getSdkConfig };
