const { error } = require('./catalog');
// Bounded single-process guards. Use gateway/Redis limits across replicas.
function createGuard({ maxActive = 6, perProject = 2, perMinute = 20, now = Date.now } = {}) {
  const rates = new Map(), active = new Map(); let total = 0;
  function enter(projectId) {
    const key = String(projectId), time = now();
    for (const [k, v] of rates) if (v.until <= time) rates.delete(k);
    if (!rates.has(key) && rates.size >= 2000) throw error('The question service is busy. Try again shortly.', 503);
    const r = rates.get(key) || { count: 0, until: time + 60000 };
    if (r.count >= perMinute) throw error('Too many questions for this project. Try again in a minute.', 429);
    if (total >= maxActive || (active.get(key) || 0) >= perProject) throw error('Another analysis is running. Wait a moment and retry.', 429);
    r.count++; rates.set(key, r); total++; active.set(key, (active.get(key) || 0) + 1);
    let released = false;
    return () => { if (released) return; released = true; total--; const count = active.get(key) - 1; if (count) active.set(key, count); else active.delete(key); };
  }
  return { enter };
}
function authorize(req) {
  const required = process.env.ASK_REQUIRE_AUTH === 'true' || (process.env.NODE_ENV === 'production' && process.env.ASK_REQUIRE_AUTH !== 'false');
  if (!required) return;
  // req.user MUST be supplied by a server-side verified auth middleware, never a header/body field.
  const id = req.user?.id || req.user?._id;
  if (!id) throw error('Dashboard authentication is required. Configure verified authentication middleware before enabling Ask in production.', 401);
  if (!req.project?.ownerId || String(req.project.ownerId) !== String(id)) throw error('You do not have access to this project.', 403);
}
module.exports = { createGuard, authorize };
