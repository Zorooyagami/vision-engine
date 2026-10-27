const mongoose = require('mongoose')

const savedExploreQuerySchema = new mongoose.Schema({
  projectId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  definition: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true })

savedExploreQuerySchema.index({ projectId: 1, name: 1 }, { unique: true })
savedExploreQuerySchema.index({ projectId: 1, updatedAt: -1 })

module.exports = mongoose.model('SavedExploreQuery', savedExploreQuerySchema)
