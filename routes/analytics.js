// routes/analytics.js
const express = require('express')
const router = express.Router()
const { analyticsFilters } = require('../middleware/analyticsFilters')
const { getKPIs, getRevenueTrend } = require('../services/analyticsService')

router.get('/kpis', analyticsFilters, getKPIs)
router.get('/revenue-trend', analyticsFilters, getRevenueTrend)

module.exports = router