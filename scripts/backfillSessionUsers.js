// scripts/backfillSessionUsers.js
// Repairs recordings stored under a guest id although the visitor logged in during the session.
// Each uploaded chunk carries the user id that was active when it was recorded, so the
// real id is read back from the chunks. Dry run by default.
//   MONGO_URI="..." node scripts/backfillSessionUsers.js           (preview)
//   MONGO_URI="..." node scripts/backfillSessionUsers.js --apply   (write changes)
const zlib = require('zlib');
const mongoose = require('mongoose');
const Session = require('../models/Session');

const apply = process.argv.includes('--apply');
const uri = 'mongodb+srv://zorooyagami_db_user:CIkhZNwzcx2Xpfu1@vision-engine.e8foaez.mongodb.net/vision?appName=vision-engine';
if (!uri) { console.error('Set MONGO_URI first.'); process.exit(1); }

const isKnown = (id) => !!id && !String(id).startsWith('guest_');

(async () => {
  await mongoose.connect(uri);
  let checked = 0, fixed = 0, failed = 0;
  const cursor = Session.find({ userId: /^guest_/ }).select('projectId sessionId userId chunks.data').lean().cursor();
  for await (const session of cursor) {
    checked++;
    let found = null;
    for (const chunk of session.chunks || []) {
      try {
        const payload = JSON.parse(zlib.unzipSync(Buffer.from(chunk.data.buffer || chunk.data)).toString('utf8'));
        if (isKnown(payload.userId) && payload.isGuest !== true) found = String(payload.userId);
      } catch { failed++; }
    }
    if (!found) continue;
    fixed++;
    console.log(`${apply ? 'FIX ' : 'WOULD FIX '}${session.projectId} ${session.sessionId}: ${session.userId} -> ${found}`);
    if (apply) await Session.updateOne({ _id: session._id }, { $set: { userId: found } }, { timestamps: false });
  }
  console.log(`\nChecked ${checked} guest sessions, ${fixed} ${apply ? 'updated' : 'would be updated'}, ${failed} chunks unreadable.`);
  await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
