const express = require("express");
const router = express.Router();
const { ingestEvents, getRecentEvents, getEventSummary,getPageHeatmaps } = require("../controllers/eventsController");

// POST /api/events — the SDK sends batched events here
router.post("/", ingestEvents);

// GET /api/events/recent — live feed / debugging helper
router.get("/recent", getRecentEvents);
router.get("/summary", getEventSummary);
router.get("/heatmaps/:pageId", getPageHeatmaps);

module.exports = router;
