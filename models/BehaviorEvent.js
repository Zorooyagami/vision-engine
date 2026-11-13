const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  projectId: { type: String, required: true }, eventId: { type: String, required: true },
  kind: { type: String, required: true }, environment: { type: String, enum: ['demo','production'], required: true },
  visitorId: { type: String, required: true }, userId: { type: String, default: null }, sessionId: { type: String, required: true },
  timestamp: { type: Date, required: true }, receivedAt: { type: Date, default: Date.now },
  path: String, device: String, data: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { minimize: false });
schema.index({ projectId: 1, eventId: 1 }, { unique: true });
schema.index({ projectId: 1, environment: 1, timestamp: 1 });
module.exports = mongoose.model('BehaviorEvent', schema);
