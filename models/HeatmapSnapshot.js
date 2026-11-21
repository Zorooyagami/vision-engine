const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  projectId: { type: String, required: true },
  key: { type: String, required: true },
  path: { type: String, required: true },
  width: Number, height: Number, viewportWidth: Number, viewportHeight: Number,
  image: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
schema.index({ projectId: 1, key: 1 }, { unique: true });
module.exports = mongoose.model('HeatmapSnapshot', schema);
