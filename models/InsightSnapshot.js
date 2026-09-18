// models/InsightSnapshot.js
const mongoose = require('mongoose');

const InsightSnapshotSchema = new mongoose.Schema({
  window: { type: String, enum: ['1d', '7d', '30d', '90d', '180d'], required: true },
  generatedAt: { type: Date, default: Date.now },
  insights: [{ type: mongoose.Schema.Types.Mixed }],
  rawFacts: { type: mongoose.Schema.Types.Mixed }, // for debugging/audit trail
});

// keep only latest snapshot per window — upsert on generation
InsightSnapshotSchema.index({ window: 1 }, { unique: true });

module.exports = mongoose.model('InsightSnapshot', InsightSnapshotSchema);