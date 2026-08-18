const express = require("express");
const router = express.Router();
const { funnel, personas } = require("../controllers/statsController");

// GET /api/stats/funnel
router.get("/funnel", funnel);

router.get("/personas", personas);

// More endpoints will be added here as we build them:
// router.get("/segments", segments);
// router.get("/anomalies", anomalies);
// router.get("/insight-summary", insightSummary);

module.exports = router;
