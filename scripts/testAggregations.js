// scripts/testAggregations.js
require('dotenv').config();
const mongoose = require('mongoose');
const { buildFactsForWindow } = require('../services/buildFacts');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const facts = await buildFactsForWindow(7); // test one window first
  console.log(JSON.stringify(facts, null, 2));
  process.exit(0);
})();