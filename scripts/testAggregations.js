require('dotenv').config();
const mongoose = require('mongoose');
const { buildFactsForWindow } = require('../services/buildFacts');

(async () => {
  if (!process.env.PROJECT_ID) throw new Error('PROJECT_ID is required');
  await mongoose.connect(process.env.MONGO_URI);
  const facts = await buildFactsForWindow(process.env.PROJECT_ID, 7);
  console.log(JSON.stringify(facts, null, 2));
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
