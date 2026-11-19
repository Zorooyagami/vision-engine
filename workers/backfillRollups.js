'use strict';
// Usage (after your existing Mongo connection has been opened):
// await backfill(process.env.PROJECT_ID, '2026-01-01', '2026-11-18')
// Integrate with your application's established connection/bootstrap process.
module.exports = require('./dailyRollups');
