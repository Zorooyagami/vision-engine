const mongoose = require('mongoose');

const chunkSchema = new mongoose.Schema(
  {
    page: { type: String, required: true },
    data: { type: Buffer, required: true },
    receivedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, trim: true },
    sessionId: { type: String, required: true },
    userId: { type: String, required: true },
    chunks: { type: [chunkSchema], default: [] },
  },
  { timestamps: true }
);

// A browser session id only needs to be unique inside a project.
sessionSchema.index({ projectId: 1, sessionId: 1 }, { unique: true });
sessionSchema.index({ projectId: 1, createdAt: -1 });
sessionSchema.index({ projectId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('Session', sessionSchema);
