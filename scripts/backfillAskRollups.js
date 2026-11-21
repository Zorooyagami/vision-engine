#!/usr/bin/env node
'use strict';
// node scripts/backfillAskRollups.js <projectId> <YYYY-MM-DD> <YYYY-MM-DD>
const mongoose = require('mongoose');
const { backfill } = require('../workers/dailyRollups');
(async () => {
  const [projectId, startDay, endDay] = process.argv.slice(2);
  if (!projectId || !/^\d{4}-\d{2}-\d{2}$/.test(startDay || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDay || '')) throw Error('Usage: node scripts/backfillAskRollups.js <projectId> <YYYY-MM-DD> <YYYY-MM-DD>');
  const uri = 'mongodb+srv://zorooyagami_db_user:CIkhZNwzcx2Xpfu1@vision-engine.e8foaez.mongodb.net/vision?appName=vision-engine'//process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw Error('MONGO_URI is required');
  await mongoose.connect(uri);
  try {
    const results = await backfill(projectId, startDay, endDay);
    console.log(`Completed ${results.length} days for project ${projectId}.`);
  } finally { await mongoose.disconnect(); }
})().catch(err => { console.error('Rollup backfill failed:', err.message); process.exitCode = 1; });
