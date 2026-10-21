const mongoose = require('mongoose');

const opportunityStatusSchema = new mongoose.Schema({
  projectId: { type: String, required: true, index: true },
  opportunityKey: { type: String, required: true },
  status: { type: String, enum: ['new', 'investigating', 'planned', 'in_progress', 'resolved', 'dismissed'], default: 'new' },
  note: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: false });
opportunityStatusSchema.index({ projectId: 1, opportunityKey: 1 }, { unique: true });
module.exports = mongoose.model('OpportunityStatus', opportunityStatusSchema);
