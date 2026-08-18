/**
 * Event model — this is the ONE collection that stores every event type
 * (page_view, click, add_to_cart, purchase, etc.). We don't use a
 * separate collection per event type; instead, `event` (the name) and
 * `properties` (a flexible object) let one schema cover everything.
 *
 * This matches exactly what the tracker SDK sends:
 * {
 *   event: "add_to_cart",
 *   userId: "u123",
 *   sessionId: "s456",
 *   timestamp: "2026-07-27T10:15:00Z",
 *   url, path, referrer,
 *   properties: { productId, price, source }
 * }
 */

const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    event: { type: String, required: true, index: true },
    // NOT required: anonymous (non-logged-in) visitors are tracked with
    // userId omitted/null — Vision explicitly needs to distinguish these
    // from logged-in users (e.g. anonymous sessions never fire purchase).
    userId: { type: String, required: false, default: null, index: true },
    sessionId: { type: String, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },

    url: String,
    path: String,
    referrer: String,

    deviceType: String, // "mobile" | "tablet" | "desktop"
    browser: String,
    trafficSource: String, // "organic" | "paid" | "social" | "direct" | "referral"
    ip: String, // ← add this
    // Flexible bag for event-specific data (productId, price, step, etc.)
    // `Mixed` means Mongoose won't enforce a fixed shape on this field —
    // exactly what we want, since every event type carries different data.
    properties: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: false, // we already store our own `timestamp` field
  }
);


// Compound index: most of our aggregation queries filter by date range
// AND group by event type — this index speeds up exactly that pattern.
eventSchema.index({ event: 1, timestamp: -1 });

module.exports = mongoose.model("Event", eventSchema);
