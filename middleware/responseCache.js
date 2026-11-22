/**
 * Short-lived in-memory cache for read-only dashboard GET endpoints.
 *
 *  - Identical requests within the TTL are answered from memory (no database work).
 *  - Identical requests arriving while one is already running share its result,
 *    so a page that fires the same call twice (or two open tabs) computes it once.
 *  - Only successful (200) JSON responses are cached; errors never are.
 *  - Mount it AFTER requireProject: the key includes the project id.
 *  - A request with "Cache-Control: no-cache" (browser hard refresh) bypasses it.
 *  - RESPONSE_CACHE_TTL_MS=0 disables it.
 */
function responseCache({ ttlMs = Number(process.env.RESPONSE_CACHE_TTL_MS ?? 30000), maxEntries = 300, maxBytes = 2_000_000 } = {}) {
  const store = new Map(); // key -> { body, expires }
  const inflight = new Map(); // key -> Promise<{ body } | null>

  return function responseCacheMiddleware(req, res, next) {
    if (ttlMs <= 0 || req.method !== 'GET') return next();
    if (/no-cache/i.test(req.headers['cache-control'] || '')) return next();

    const key = `${req.projectId || ''}|${req.originalUrl}`;
    const send = (body, state) => {
      res.set('X-Cache', state);
      res.status(200).type('application/json').send(body);
    };

    const hit = store.get(key);
    if (hit && hit.expires > Date.now()) return send(hit.body, 'HIT');
    if (hit) store.delete(key);

    const running = inflight.get(key);
    if (running) {
      running.then((result) => (result ? send(result.body, 'SHARED') : next()), () => next());
      return undefined;
    }

    let settle;
    inflight.set(key, new Promise((resolve) => { settle = resolve; }));
    let finished = false;
    const done = (result) => {
      if (finished) return;
      finished = true;
      inflight.delete(key);
      settle(result);
    };

    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      if (res.statusCode === 200) {
        try {
          const body = JSON.stringify(payload);
          if (body.length <= maxBytes) {
            if (store.size >= maxEntries) store.delete(store.keys().next().value);
            store.set(key, { body, expires: Date.now() + ttlMs });
            done({ body });
          } else done(null);
        } catch {
          done(null);
        }
      } else {
        done(null);
      }
      res.set('X-Cache', 'MISS');
      return originalJson(payload);
    };
    res.on('close', () => done(null)); // handler failed/aborted: let waiters run themselves
    return next();
  };
}

module.exports = { responseCache };
