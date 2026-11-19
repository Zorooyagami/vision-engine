'use strict';
// Idempotent daily event-count rollups. Run in a single scheduled worker.
// Raw events remain authoritative; this is a read-optimized projection.
const { randomUUID } = require('node:crypto');
const Event = require('../models/Event');
const mongoose = require('mongoose');
const DAY = 86400000;
const name = 'daily_event_rollups';
const dates = 'daily_rollup_progress';
async function ensureIndexes() {
  const db = mongoose.connection.db;
  await db.collection(name).createIndex({ projectId: 1, day: 1, event: 1, device: 1, source: 1 }, { unique: true });
  await db.collection(dates).createIndex({ projectId: 1, day: 1 }, { unique: true });
}
async function rebuildDay(projectId, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(day).toISOString().slice(0, 10) !== day) throw Error('Invalid UTC day');
  const start = new Date(`${day}T00:00:00.000Z`), end = new Date(+start + DAY);
  const db = mongoose.connection.db, job = randomUUID();
  const match = { projectId, timestamp: { $gte: start, $lt: end } };
  await db.collection(dates).updateOne({ projectId, day }, { $set: { state: 'building', updatedAt: new Date() } }, { upsert: true });
  try {
    const cursor = Event.aggregate([
      { $match: match },
      { $project: { event: 1, device: { $ifNull: ['$deviceInfo.deviceType', 'Unknown'] }, source: { $ifNull: ['$trafficSource', 'Unknown'] } } },
      { $group: { _id: { event: '$event', device: '$device', source: '$source' }, events: { $sum: 1 } } }
    ]).allowDiskUse(true).cursor({ batchSize: 250 });
    const collection = db.collection(name);
    let count = 0, ops = [];
    for await (const row of cursor) {
      ops.push({ updateOne: { filter: { projectId, day, event: row._id.event, device: row._id.device, source: row._id.source }, update: { $set: { events: row.events, job, updatedAt: new Date() } }, upsert: true } });
      if (ops.length >= 250) { await collection.bulkWrite(ops, { ordered: false }); ops = []; }
      count++;
    }
    if (ops.length) await collection.bulkWrite(ops, { ordered: false });
    await collection.deleteMany({ projectId, day, job: { $ne: job } });
    await db.collection(dates).updateOne({ projectId, day }, { $set: { state: 'complete', updatedAt: new Date(), groups: count } });
    return { day, groups: count };
  } catch (err) {
    await db.collection(dates).updateOne({ projectId, day }, { $set: { state: 'failed', updatedAt: new Date(), reason: err.codeName || err.name } });
    throw err;
  }
}
async function backfill(projectId, startDay, endDay) {
  await ensureIndexes();
  const start = new Date(`${startDay}T00:00:00.000Z`), end = new Date(`${endDay}T00:00:00.000Z`);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start > end) throw Error('Invalid day range');
  const results = [];
  for (let time = +start; time <= +end; time += DAY) results.push(await rebuildDay(projectId, new Date(time).toISOString().slice(0, 10)));
  return results;
}
module.exports = { ensureIndexes, rebuildDay, backfill };
