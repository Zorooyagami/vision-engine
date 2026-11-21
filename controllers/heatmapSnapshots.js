const HeatmapSnapshot = require('../models/HeatmapSnapshot');
const VALID_IMAGE = /^data:image\/webp;base64,[a-zA-Z0-9+/=]+$/;
const ALLOWED_PATH = /^\/(?:$|products$|products-detail\/[^/]+$)/;
async function upload(req, res) {
  try {
    if (req.project?.settings?.heatmaps === false) return res.sendStatus(403);
    const { key, path, width, height, viewportWidth, viewportHeight, image } = req.body || {};
    const values = [width, height, viewportWidth, viewportHeight];
    if (!/^layout-v1-[a-z0-9]+$/.test(key || '') || !ALLOWED_PATH.test(path || '') ||
        !values.every(v => Number.isFinite(v) && v > 0 && v <= 15000) ||
        typeof image !== 'string' || image.length > 1650000 || !VALID_IMAGE.test(image)) {
      return res.status(400).json({ error: 'invalid capture' });
    }
    // Bound screenshot storage for this project; old captures can be curated later.
    const exists = await HeatmapSnapshot.exists({ projectId: req.projectId, key });
    if (!exists && (await HeatmapSnapshot.countDocuments({ projectId: req.projectId })) >= 120)
      return res.status(429).json({ error: 'capture limit reached' });
    // Deduplicate layouts. Never let retries overwrite a capture with different content.
    await HeatmapSnapshot.updateOne({ projectId: req.projectId, key }, {
      $setOnInsert: { projectId: req.projectId, key, path, width, height,
        viewportWidth, viewportHeight, image }
    }, { upsert: true });
    res.status(201).json({ key });
  } catch (error) {
    if (error.code === 11000) return res.json({ key: req.body.key });
    console.error('[heatmap capture]', error);
    res.sendStatus(500);
  }
}
async function list(req, res) {
  try {
    const snapshots = await HeatmapSnapshot.find({ projectId: req.projectId })
      .select('key path width height viewportWidth viewportHeight createdAt')
      .sort({ createdAt: -1 }).limit(250).lean();
    res.json({ snapshots });
  } catch (error) { res.sendStatus(500); }
}
async function image(req, res) {
  try {
    const item = await HeatmapSnapshot.findOne({ projectId: req.projectId, key: req.params.key })
      .select('image').lean();
    if (!item) return res.sendStatus(404);
    const data = Buffer.from(item.image.slice('data:image/webp;base64,'.length), 'base64');
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(data);
  } catch (error) { res.sendStatus(500); }
}
module.exports = { upload, list, image };
