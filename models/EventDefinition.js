const mongoose = require('mongoose');

// Optional "no-code" trigger: lets a dashboard admin tag a page element so the
// hosted SDK fires this event on its own, without any change to the site's code.
const capturedPropertySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 },
    // text  -> element's visible text
    // attr  -> value of the attribute named in `source`
    // value -> element's .value (inputs/selects; never read for password fields)
    // static-> the literal string in `source`
    from: { type: String, enum: ['text', 'attr', 'value', 'static'], default: 'text' },
    source: { type: String, default: '', maxlength: 200 },
  },
  { _id: false }
);

const triggerSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['click'], default: 'click' },
    selector: { type: String, required: true, trim: true, maxlength: 500 },
    urlMatch: {
      mode: { type: String, enum: ['any', 'equals', 'contains', 'starts_with'], default: 'any' },
      value: { type: String, default: '', maxlength: 300 },
    },
    properties: { type: [capturedPropertySchema], default: [] },
  },
  { _id: false }
);

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

    // 'code'      -> fired by the site's own code via window.vision.track()
    // 'dashboard' -> fired by the SDK from `trigger`, defined in this dashboard
    source: { type: String, enum: ['code', 'dashboard'], default: 'code' },
    trigger: { type: triggerSchema, default: undefined },
  },
  { timestamps: true }
);

eventDefinitionSchema.index({ projectId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('EventDefinition', eventDefinitionSchema);
