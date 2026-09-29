/**
 * One-time migration for the original single-project Dev Day dataset.
 *
 * Usage:
 *   PROJECT_ID=vis_xxx MONGO_URI='...' node scripts/migrateProjectScope.js
 *
 * Optional:
 *   MIGRATE_USERS=true   Assign legacy users (projectId null/missing) too.
 *   SYNC_INDEXES=true    Replace obsolete global unique indexes with the new
 *                        project-scoped indexes after the data is migrated.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Project = require('../models/Project');
const Event = require('../models/Event');
const Session = require('../models/Session');
const User = require('../models/User');
const EventDefinition = require('../models/EventDefinition');
const InsightSnapshot = require('../models/InsightSnapshot');

async function main() {
  const projectId = 'vis_6bcd1aef732e0d5d'//process.env.PROJECT_ID;
  if (!projectId) throw new Error('PROJECT_ID is required');
  // if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');

  await mongoose.connect('mongodb+srv://zorooyagami_db_user:CIkhZNwzcx2Xpfu1@vision-engine.e8foaez.mongodb.net/vision?appName=vision-engine');
  const project = await Project.findOne({ projectId }).lean();
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const legacy = { $or: [{ projectId: { $exists: false } }, { projectId: null }, { projectId: '' }] };
  const results = {};
  results.events = await Event.updateMany(legacy, { $set: { projectId } });
  results.sessions = await Session.updateMany(legacy, { $set: { projectId } });
  results.eventDefinitions = await EventDefinition.updateMany(legacy, { $set: { projectId } });
  results.insightSnapshots = await InsightSnapshot.updateMany(legacy, { $set: { projectId } });

  if (process.env.MIGRATE_USERS === 'true') {
    results.users = await User.updateMany(legacy, { $set: { projectId } });
  }

  console.log('[migration] updated documents');
  Object.entries(results).forEach(([name, result]) => {
    console.log(`  ${name}: matched=${result.matchedCount} modified=${result.modifiedCount}`);
  });

  if (process.env.SYNC_INDEXES === 'true') {
    console.log('[migration] syncing indexes (this may drop obsolete indexes)...');
    for (const model of [Event, Session, User, EventDefinition, InsightSnapshot, Project]) {
      const dropped = await model.syncIndexes();
      console.log(`  ${model.modelName}: dropped [${dropped.join(', ')}]`);
    }
  } else {
    console.log('[migration] indexes NOT synced. Run again with SYNC_INDEXES=true after reviewing the migration.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[migration] failed:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
