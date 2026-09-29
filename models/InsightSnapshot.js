const mongoose = require('mongoose');

const InsightSnapshotSchema = new mongoose.Schema({
  projectId: { type: String, required: true, trim: true },
  window: {
    type: String,
    enum: ['1d', '7d', '30d', '90d', '180d'],
    required: true,
  },
  generatedAt: { type: Date, default: Date.now },
  insights: [{ type: mongoose.Schema.Types.Mixed }],
  rawFacts: { type: mongoose.Schema.Types.Mixed },
});

// Keep only the latest generated snapshot for each project/window pair.
InsightSnapshotSchema.index({ projectId: 1, window: 1 }, { unique: true });

module.exports = mongoose.model('InsightSnapshot', InsightSnapshotSchema);
