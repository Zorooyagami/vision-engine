// vision-engine/models/Funnel.js
const mongoose = require('mongoose')

const funnelSchema = new mongoose.Schema(
  {
    // Every funnel belongs to exactly one project.
    // Set from req.projectId on the server, never from the request body.
    // Public Vision project id (e.g. "vis_6bcd1aef732e0d5d") - a String, same as Event.projectId.
    projectId: {
      type: String,
      required: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },

    // Ordered list of event names, e.g. ['view_item_list', 'add_to_cart', 'purchase']
    steps: {
      type: [String],
      validate: {
        validator: (v) =>
          Array.isArray(v) &&
          v.length >= 2 &&
          v.length <= 10 &&
          new Set(v).size === v.length,
        message: 'A funnel needs 2-10 unique steps',
      },
    },

    // A user must complete all steps within this many days of step 1.
    conversionWindowDays: {
      type: Number,
      required: true,
      min: 1,
      max: 90,
      default: 7,
    },
  },
  { timestamps: true }, // createdAt / updatedAt (replaces the mock "lastEdited")
)

// Names are unique per project, case-insensitive.
funnelSchema.index(
  { projectId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
)
funnelSchema.index({ projectId: 1, updatedAt: -1 })

module.exports = mongoose.models.Funnel || mongoose.model('Funnel', funnelSchema)