const { getRevenueByPersona } = require('./revenueByPersona');

// The leaderboard uses the same authoritative revenue/persona classification
// as the Revenue page instead of maintaining another divergent query.
async function getPersonaLeaderboard(options) {
  return getRevenueByPersona(options);
}

module.exports = { getPersonaLeaderboard };
