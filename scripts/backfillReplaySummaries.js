#!/usr/bin/env node
'use strict';
/**
 * Adds the per-chunk activity summary (spans/firstTs/lastTs) to recordings made
 * before it existed, so the session list shows active duration for them too.
 * Safe to re-run: only chunks without a summary are touched.
 *
 *   MONGO_URI="<your connection string>" node scripts/backfillReplaySummaries.js [projectId] [--dry-run]
 */
const zlib = require('zlib');
const mongoose = require('mongoose');
const Session = require('../models/Session');
const { chunkSummary } = require('../services/replayTimeline');

const unzip = (buf) => new Promise((resolve, reject) =>
  zlib.unzip(buf, { maxOutputLength: 20 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out))));

(async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const projectId = args.find((a) => !a.startsWith('--')) || null;
  const uri = 'mongodb+srv://zorooyagami_db_user:CIkhZNwzcx2Xpfu1@vision-engine.e8foaez.mongodb.net/vision?appName=vision-engine'//'process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw Error('MONGO_URI is required');
  await mongoose.connect(uri);

  const query = { chunks: { $elemMatch: { spans: { $exists: false } } } };
  if (projectId) query.projectId = projectId;

  let sessions = 0;
  let chunksUpdated = 0;
  let failed = 0;
  const cursor = Session.find(query).select({ projectId: 1, sessionId: 1, chunks: 1 }).lean().cursor();
  for await (const session of cursor) {
    const $set = {};
    for (let i = 0; i < session.chunks.length; i += 1) {
      const chunk = session.chunks[i];
      if (Array.isArray(chunk.spans)) continue;
      try {
        const buf = Buffer.isBuffer(chunk.data) ? chunk.data : Buffer.from(chunk.data?.buffer || chunk.data);
        const payload = JSON.parse((await unzip(buf)).toString('utf8'));
        const s = chunkSummary(payload.events);
        if (!s) continue;
        $set[`chunks.${i}.spans`] = s.spans;
        $set[`chunks.${i}.firstTs`] = s.firstTs;
        $set[`chunks.${i}.lastTs`] = s.lastTs;
      } catch (err) {
        failed += 1;
        console.warn(`  skip ${session.sessionId} chunk ${i}: ${err.message}`);
      }
    }
    if (!Object.keys($set).length) continue;
    sessions += 1;
    chunksUpdated += Object.keys($set).length / 3;
    if (!dryRun) {
      await Session.updateOne({ _id: session._id }, { $set }, { timestamps: false });
    }
  }
  console.log(`${dryRun ? '[dry run] would update' : 'Updated'} ${chunksUpdated} chunks in ${sessions} sessions (${failed} chunks failed).`);
  await mongoose.disconnect();
})().catch((err) => { console.error('Backfill failed:', err.message); process.exitCode = 1; });
