const express = require("express");
const router = express.Router();
const { ingestEvents, getRecentEvents, getEventSummary } = require("../controllers/eventsController");

const app = express();

app.set("trust proxy", true);

app.use(express.json());
// POST /api/events — the SDK sends batched events here
router.post("/", ingestEvents);

// GET /api/events/recent — live feed / debugging helper
router.get("/recent", getRecentEvents);
router.get("/summary", getEventSummary);

module.exports = router;
