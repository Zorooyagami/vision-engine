const express = require('express');
const router = express.Router();
const { requireProject } = require('../middleware/requireProject');
const { analyticsFilters } = require('../middleware/analyticsFilters');
const { getKPIs, getRevenueTrend } = require('../services/analyticsService');

router.use(requireProject);
router.get('/kpis', analyticsFilters, getKPIs);
router.get('/revenue-trend', analyticsFilters, getRevenueTrend);

module.exports = router;
