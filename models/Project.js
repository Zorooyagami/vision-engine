const mongoose = require('mongoose')

const projectSchema = new mongoose.Schema(
  {
    /*
     * Public ID used by the SDK.
     *
     * Example:
     * vis_c781bf932ecee8d1
     *
     * This is NOT a secret.
     */
    projectId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    /*
     * Project display name
     *
     * Example:
     * ShopEasy
     */
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    /*
     * Primary website.
     *
     * Store origin only:
     * https://shopeasy.com
     *
     * NOT:
     * https://shopeasy.com/products
     */
    websiteUrl: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },

    /*
     * Used by ingestion API.
     *
     * Example:
     *
     * [
     *   "https://shopeasy.com",
     *   "https://www.shopeasy.com"
     * ]
     */
    allowedOrigins: {
      type: [String],
      default: [],
    },

    /*
     * Later this will identify the dashboard user
     * who owns the project.
     *
     * If auth isn't implemented yet,
     * this can remain null temporarily.
     */
    ownerId: {
      type: String,
      default: null,
      index: true,
    },

    settings: {
      analytics: {
        type: Boolean,
        default: true,
      },

      heatmaps: {
        type: Boolean,
        default: true,
      },

      sessionReplay: {
        type: Boolean,
        default: true,
      },
    },

    status: {
      type: String,
      enum: [
        'active',
        'disabled',
      ],
      default: 'active',
    },

    /*
     * Useful later for:
     *
     * "Vision connected"
     * "Last event received 20 seconds ago"
     */
    lastEventAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
)

/*
 * Useful once users can own multiple projects.
 */
projectSchema.index({
  ownerId: 1,
  createdAt: -1,
})

module.exports = mongoose.model(
  'Project',
  projectSchema
)