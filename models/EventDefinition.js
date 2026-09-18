const mongoose = require('mongoose');

const eventDefinitionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: '' },
    category: { type: String, enum: ['browsing', 'cart', 'checkout', 'other'], default: 'other' },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EventDefinition', eventDefinitionSchema);