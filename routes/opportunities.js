const express = require('express');
const { requireProject } = require('../middleware/requireProject');
const { buildRadar, updateOpportunityStatus } = require('../services/opportunities');
const router = express.Router();
router.use(requireProject);
router.get('/', async (req, res) => {
  try {
    const { period = '30d', platform = 'combined', device, from, to, personas } = req.query;
    const validPeriods = ['1d', '7d', '30d', '90d', '180d', 'custom'];
    if (!validPeriods.includes(period)) return res.status(400).json({ error: 'Unsupported period' });
    if (period === 'custom' && (!from || !to)) return res.status(400).json({ error: 'Custom period requires from and to' });
    if (!['combined', 'web', 'app'].includes(platform)) return res.status(400).json({ error: 'Invalid platform' });
    const parsedPersonas = personas ? String(personas).split(',').map((p) => p.trim().toLowerCase()).filter(Boolean) : [];
    const allowed = ['loyal', 'firsttime', 'active', 'guest'];
    if (parsedPersonas.some((p) => !allowed.includes(p))) return res.status(400).json({ error: 'Invalid persona filter' });
    const data = await buildRadar({ projectId: req.projectId, period, platform, device: device || undefined, customRange: from && to ? { from, to } : null, personas: parsedPersonas });
    res.json(data);
  } catch (error) {
    console.error('[opportunities] build failed', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to build revenue opportunity radar' });
  }
});
router.patch('/:key/status', async (req, res) => {
  try {
    const result = await updateOpportunityStatus({ projectId: req.projectId, opportunityKey: req.params.key, status: req.body?.status, note: req.body?.note });
    res.json({ opportunity: { key: result.opportunityKey, status: result.status, note: result.note, updatedAt: result.updatedAt } });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to update opportunity' });
  }
});
module.exports = router;
