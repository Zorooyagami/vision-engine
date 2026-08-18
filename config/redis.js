/**
 * Redis connection setup.
 *
 * Reminder of WHY we use Redis in this project (only two jobs):
 *   1. Caching which A/B... wait — no A/B testing in Vision. Instead:
 *      Caching computed stats (funnel/segment results) so the dashboard
 *      doesn't hit MongoDB with a heavy aggregation query on every load.
 *   2. Fast increment counters if/when we need real-time tallies
 *      (e.g., live event counts for the "live dashboard update" feature).
 *
 * We export a single connected client, plus two tiny helper functions
 * (`cacheGet` / `cacheSet`) so the rest of the codebase never has to
 * think about Redis's raw command syntax.
 */

const { createClient } = require("redis");

let client;

async function connectRedis() {
  const url = process.env.REDIS_URL || "redis://localhost:6379";

  client = createClient({ url });

  client.on("error", (err) => console.error("[redis] error:", err.message));

  await client.connect();
  console.log("[redis] connected:", url);

  return client;
}

/**
 * Get a cached value by key. Returns null if not found or expired.
 * We store everything as JSON strings, so this parses it back for you.
 */
async function cacheGet(key) {
  const raw = await client.get(key);
  if (!raw) return null;
  return JSON.parse(raw);
}

/**
 * Store a value under a key, with an expiry (in seconds).
 * Default expiry: 60 seconds — short, because our stats change often
 * and we'd rather recompute slightly more often than show stale data
 * on a demo. Tune this later once real query costs are known.
 */
async function cacheSet(key, value, ttlSeconds = 60) {
  await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
}

function getClient() {
  if (!client) {
    throw new Error("Redis client not initialised — call connectRedis() first");
  }
  return client;
}

module.exports = { connectRedis, cacheGet, cacheSet, getClient };
