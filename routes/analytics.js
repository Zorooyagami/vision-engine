const express = require('express');
const router = express.Router();
const { requireProject } = require('../middleware/requireProject');
const { analyticsFilters } = require('../middleware/analyticsFilters');
const { getKPIs, getRevenueTrend } = require('../services/analyticsService');
const { getProductIntelligence } = require('../services/productIntelligence');
const { getAudienceIntelligence } = require('../services/audienceIntelligence');

router.use(requireProject);
router.get('/kpis', analyticsFilters, getKPIs);
router.get('/revenue-trend', analyticsFilters, getRevenueTrend);
router.get('/products', getProductIntelligence);
router.get('/audience', getAudienceIntelligence);

module.exports = router;
