const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    // Kept optional during migration so the existing demo auth can continue to
    // work. New project-aware auth requests should always populate projectId.
    projectId: { type: String, default: null },

    userId: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

// Users are unique within a project. projectId:null preserves the legacy demo
// tenant until its records are migrated.
userSchema.index({ projectId: 1, userId: 1 }, { unique: true });
userSchema.index({ projectId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
