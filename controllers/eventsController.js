/**
 * Events Controller
 * -----------------
 * Handles events coming from the Vision Tracker SDK.
 */

const Event = require("../models/Event");

/**
 * Funnel events used by the analytics dashboard.
 */
const FUNNEL_EVENTS = [
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "view_cart",
  "checkout_start",
  "purchase",
];

/**
 * POST /api/events
 *
 * Body:
 * {
 *   events: [
 *     {
 *       event,
 *       userId,
 *       sessionId,
 *       timestamp,
 *       ...
 *     }
 *   ]
 * }
 */
async function ingestEvents(req, res) {
  try {
    const { events } = req.body;

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        error: "events must be a non-empty array",
      });
    }

    if (events.length > 100) {
      return res.status(400).json({
        error: "maximum 100 events per batch",
      });
    }

    // NOTE: userId is intentionally NOT required here. Anonymous
    // (non-logged-in) visitors are valid — they're tracked via
    // sessionId alone, with userId left null. Only event/sessionId/
    // timestamp are the true minimum requirements for a valid event.
    const validEvents = events.filter(
      (e) =>
        e &&
        e.event &&
        e.sessionId &&
        e.timestamp
    );

    if (validEvents.length === 0) {
      return res.status(400).json({
        error: "no valid events in payload",
      });
    }

    const ip = req.ip;

    const documents = validEvents.map((e) => ({
      ...e,
      ip,
      timestamp: new Date(e.timestamp),
    }));

    const result = await Event.insertMany(documents, {
      ordered: false,
    });

    return res.status(201).json({
      inserted: result.length,
      received: events.length,
      rejected: events.length - validEvents.length,
    });

  } catch (err) {
    console.error("[events] ingest error:", err);

    return res.status(500).json({
      error: "failed to ingest events",
    });
  }
}


/**
 * GET /api/events/recent
 *
 * Example:
 * GET /api/events/recent?limit=20
 */
async function getRecentEvents(req, res) {
  try {
    const requestedLimit = parseInt(
      req.query.limit,
      10
    );

    const limit = Math.min(
      Number.isNaN(requestedLimit)
        ? 20
        : requestedLimit,
      100
    );

    const events = await Event.find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    return res.json({
      events,
    });

  } catch (err) {
    console.error(
      "[events] recent fetch error:",
      err
    );

    return res.status(500).json({
      error: "failed to fetch recent events",
    });
  }
}


/**
 * GET /api/events/summary
 *
 * Returns the number of occurrences of each funnel event.
 *
 * Example:
 *
 * GET /api/events/summary
 *
 * Response:
 *
 * {
 *   "events": [
 *     {
 *       "event": "product_view",
 *       "count": 596
 *     },
 *     ...
 *   ]
 * }
 */
async function getEventSummary(req, res) {
  try {

    const summary = await Event.aggregate([
      {
        $match: {
          event: {
            $in: FUNNEL_EVENTS,
          },
        },
      },

      {
        $group: {
          _id: "$event",
          count: {
            $sum: 1,
          },
        },
      },

      {
        $project: {
          _id: 0,
          event: "$_id",
          count: 1,
        },
      },

      {
        $sort: {
          count: -1,
        },
      },
    ]);

    return res.json({
      events: summary,
    });

  } catch (err) {

    console.error(
      "[events] summary error:",
      err
    );

    return res.status(500).json({
      error: "failed to fetch event summary",
    });
  }
}

async function getPageHeatmaps(req, res) {
  try {
    const { pageId } = req.params;

    const pagesMapping = [
      'home',
      'products',
      'product_detail',
      'cart'
    ];

    const page = pagesMapping[pageId];

    if (!page) {
      return res.status(400).json({
        error: "invalid pageId"
      });
    }

    // Convert page name to actual URL path
    const pagePaths = {
      home: '/',
      products: '/products',
      product_detail: '/product/',
      cart: '/cart'
    };

    const path = pagePaths[page];
    // delete all heatmaps
  // const result = await Event.deleteMany({
  //       event: {
  //         $in: ["heatmap_move", "heatmap_click"]
  //       }
  //   });
    const events = await Event.find({
  event: {
    $in: ['heatmap_move', 'heatmap_click']
  },
  path: page === 'product_detail'
    ? { $regex: '^/products-detail/' }
    : path
})
  .select({
    _id: 1,
    sessionId: 1,
    userId: 1,
    event: 1,
    timestamp: 1,
    path: 1,
    properties: 1
  })
  .sort({ timestamp: 1 })
  .lean();

    return res.json({
      page,
      events
    });

  } catch (err) {
    console.error("[events] heatmap error:", err);

    return res.status(500).json({
      error: "failed to fetch heatmap data"
    });
  }
}

module.exports = {
  ingestEvents,
  getRecentEvents,
  getEventSummary,
  getPageHeatmaps
};