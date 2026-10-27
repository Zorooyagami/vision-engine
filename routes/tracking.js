const router = require('express').Router();
const crypto = require('crypto');
const EventDefinition = require('../models/EventDefinition');
const { requireProject } = require('../middleware/requireProject');
const { checkOrigin } = require('../middleware/checkOrigin');
const { validateTracking } = require('../services/trackingValidation');
const { assertNameAvailable } = require('../services/eventCatalog');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(error => {
  if (error instanceof TypeError || error.name === 'ValidationError' || error.message.startsWith('Use ') || error.message.startsWith('Choose ') || error.message.startsWith('An element')) return res.status(400).json({ error: error.message });
  next(error);
});
router.use(requireProject);
router.get('/config', checkOrigin, wrap(async (req, res) => {
  const definitions = req.project.settings?.analytics === false ? [] : await EventDefinition.find({ projectId: req.projectId, status: 'Active', tracking: { $exists: true } }).lean();
  res.set('Cache-Control', 'no-store').json({ rules: definitions.map(d => ({ id: String(d._id), eventName: d.name, ...d.tracking })) });
}));
// Picker integrity is independent of admin authentication. No setup is required.
// An optional shared signing key keeps tickets valid across replicas/restarts.
const pickerSigningKey = process.env.VISION_PICKER_SIGNING_KEY || crypto.randomBytes(32).toString('hex');
function sign(payload, secret) { return crypto.createHmac('sha256', secret).update(payload).digest('base64url'); }
router.post('/picker/verify', checkOrigin, wrap(async (req, res) => {
  const [payload, signature] = String(req.body.token || '').split('.');
  const secret = pickerSigningKey;
  if (!payload || !signature || !secret) return res.status(403).json({ error: 'Invalid picker session' });
  const expected = sign(payload, secret);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(403).json({ error: 'Invalid picker session' });
  const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (ticket.projectId !== req.projectId || ticket.targetOrigin !== req.headers.origin || ticket.expiresAt < Date.now()) return res.status(403).json({ error: 'Picker session expired or belongs to another site' });
  res.set('Cache-Control', 'no-store').json(ticket);
}));
router.get('/name-availability', wrap(async (req, res) => {
  try { const name = await assertNameAvailable(req.projectId, req.query.name); res.json({ available: true, name }); }
  catch (e) { res.status(e.status || 400).json({ available: false, error: e.message }); }
}));
router.post('/picker/session', wrap(async (req, res) => {
  const target = new URL(req.body.pageUrl);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || !req.project.allowedOrigins.includes(target.origin)) return res.status(400).json({ error: 'Page URL must belong to a project allowed origin.' });
  const dashboardOrigin = req.headers.origin;
  if (!dashboardOrigin || !['http:', 'https:'].includes(new URL(dashboardOrigin).protocol)) return res.status(400).json({ error: 'Dashboard origin is required' });
  const ticket = { projectId: req.projectId, targetOrigin: target.origin, dashboardOrigin, expiresAt: Date.now() + 15 * 60 * 1000, nonce: crypto.randomBytes(24).toString('hex') };
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  res.set('Cache-Control', 'no-store').json({ token: payload + '.' + sign(payload, pickerSigningKey), ...ticket });
}));
router.patch('/rules/:name', wrap(async (req, res) => {
  const tracking = validateTracking(req.body.tracking, req.project);
  const event = await EventDefinition.findOneAndUpdate({ projectId: req.projectId, name: req.params.name, tracking: { $exists: true } }, { $set: { tracking, status: req.body.status === 'Active' ? 'Active' : 'Inactive', description: String(req.body.description || '').slice(0, 500) } }, { new: true, runValidators: true });
  if (!event) return res.status(404).json({ error: 'Click event not found' });
  res.json({ event });
}));
module.exports = router;
