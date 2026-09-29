const mongoose = require('mongoose');

/**
 * Multi-tenant analytics event.
 *
 * Every event is scoped to a public Vision projectId. The SDK project id is
 * not a secret; isolation is enforced by validating the project/origin during
 * ingestion and by including projectId in every dashboard query.
 */
const eventSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, trim: true },
    event: { type: String, required: true, trim: true },

    // Anonymous visitors intentionally use null userId.
    userId: { type: String, required: false, default: null },
    sessionId: { type: String, required: true },
    timestamp: { type: Date, required: true },

    url: String,
    path: String,
    referrer: String,

    deviceInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
    browser: String,
    trafficSource: String,
    ip: String,
    properties: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: false }
);

// The dashboard almost always filters by project first, then time/event/user.
// These compound indexes prevent large multi-project collections from turning
// into collection scans.
eventSchema.index({ projectId: 1, timestamp: -1 });
eventSchema.index({ projectId: 1, event: 1, timestamp: -1 });
eventSchema.index({ projectId: 1, userId: 1, timestamp: -1 });
eventSchema.index({ projectId: 1, sessionId: 1, timestamp: 1 });
eventSchema.index({ projectId: 1, path: 1, event: 1, timestamp: -1 });

module.exports = mongoose.model('Event', eventSchema);
