/**
 * Read-only sanity check after migrating the original single-project dataset.
 *
 * Usage:
 *   MONGO_URI='...' PROJECT_ID=vis_xxx node scripts/verifyProjectScope.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Project = require('../models/Project');
const Event = require('../models/Event');
const Session = require('../models/Session');
const User = require('../models/User');
const EventDefinition = require('../models/EventDefinition');
const InsightSnapshot = require('../models/InsightSnapshot');

const LEGACY_SCOPE = {
  $or: [
    { projectId: { $exists: false } },
    { projectId: null },
    { projectId: '' },
  ],
};

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);

  const models = [Event, Session, EventDefinition, InsightSnapshot, User];
  const projectId = process.env.PROJECT_ID || null;

  console.log(`[verify] projects=${await Project.countDocuments({})}`);
  if (projectId) {
    const project = await Project.findOne({ projectId }).lean();
    console.log(`[verify] selected project ${projectId}: ${project ? 'FOUND' : 'NOT FOUND'}`);
  }

  for (const model of models) {
    const legacy = await model.countDocuments(LEGACY_SCOPE);
    const scoped = projectId ? await model.countDocuments({ projectId }) : null;
    console.log(
      `[verify] ${model.modelName}: legacy/unscoped=${legacy}` +
      (projectId ? ` selectedProject=${scoped}` : '')
    );
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[verify] failed:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
