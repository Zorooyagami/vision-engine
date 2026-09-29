const mongoose = require('mongoose');

const eventDefinitionSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: {
      type: String,
      enum: ['browsing', 'cart', 'checkout', 'other'],
      default: 'other',
    },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);

eventDefinitionSchema.index({ projectId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('EventDefinition', eventDefinitionSchema);
