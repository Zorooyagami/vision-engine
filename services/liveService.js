// services/liveService.js
// Live mode with NO external dependencies: in-process EventEmitter + in-memory active sessions.
// Works for a single Node process (fine for a demo). To scale out later, swap the bus and the
// maps for Redis pub/sub + a sorted set; publishEvent / streamHandler keep the same API.
const { EventEmitter } = require('events');
const mongoose = require('mongoose');

const WINDOW_MS = 5 * 60 * 1000; // a session is "active" for 5 min after its last event
const RECENT_MAX = 20;           // events replayed to a dashboard when it connects

const bus = new EventEmitter();
bus.setMaxListeners(0);

const active = new Map(); // projectId -> Map(sessionId -> lastSeenMs)
const recent = new Map(); // projectId -> [liveEvent]
const clients = new Set(); // { res, projectId }

// High-volume noise events are kept out of the live feed.
const NOISE = new Set(['heatmap_move', 'heatmap_click']);
const MAX_PROPS = 12;
const SKIP_PROP = /mail|phone|pass|token|card|address|ip$/i; // never leak PII to the feed
function liveProps(src) {
  const out = {};
  const put = (k, v) => {
    if (Object.keys(out).length >= MAX_PROPS || SKIP_PROP.test(k)) return;
    if (typeof v === 'string') out[k] = v.slice(0, 80);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v) && v.every((x) => ['string', 'number'].includes(typeof x))) out[k] = v.slice(0, 5).join(', ');
  };
  for (const [k, v] of Object.entries(src || {})) {
    // nested object (or first item of an array of objects): flatten one level, e.g. "item.name"
    const first = Array.isArray(v) ? v[0] : v;
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      for (const [sk, sv] of Object.entries(first)) put(`${k}.${sk}`, sv);
    } else put(k, v);
  }
  return out;
}

// Keep the payload light: only what the live feed UI needs (matches models/Event.js).
function toLiveEvent(e) {
  const o = typeof e.toObject === 'function' ? e.toObject() : e;
  const props = liveProps(o.properties);
  return {
    projectId: String(o.projectId),
    event: o.event,
    userId: o.userId || null, // null = anonymous visitor
    isGuest: !o.userId,
    name: null, // filled in by resolveName()
    sessionId: o.sessionId,
    path: o.path || null,
    browser: o.browser || (o.deviceInfo && o.deviceInfo.browser) || null,
    os: (o.deviceInfo && o.deviceInfo.os) || null,
    device: (o.deviceInfo && o.deviceInfo.deviceType) || null, // Desktop | Mobile | Tablet
    source: o.trafficSource || null,
    props,
    ts: o.timestamp ? new Date(o.timestamp).getTime() : Date.now(),
  };
}

function activeCount(projectId) {
  const m = active.get(projectId);
  if (!m) return 0;
  const cutoff = Date.now() - WINDOW_MS;
  let n = 0;
  for (const t of m.values()) if (t >= cutoff) n++;
  return n;
}

// userId -> display name, cached 10 min so the feed never hammers Mongo.
const names = new Map();
async function resolveName(projectId, userId) {
  if (!userId) return null;
  const key = `${projectId}:${userId}`;
  const hit = names.get(key);
  if (hit && hit.exp > Date.now()) return hit.name;
  let name = null;
  try {
    const u = await mongoose.connection
      .collection('users')
      .findOne({ userId, projectId }, { projection: { name: 1 } });
    name = (u && u.name) || null;
  } catch (err) {
    console.error('[live] name lookup failed', err.message);
  }
  if (names.size > 5000) names.clear();
  names.set(key, { name, exp: Date.now() + 10 * 60 * 1000 });
  return name;
}

// Call this (without await) right after events are saved.
// Never throws: live mode must not break ingestion.
function publishEvent(rawEvent) {
  try {
    const e = toLiveEvent(rawEvent);
    if (!e.projectId || !e.sessionId || NOISE.has(e.event)) return;
    if (!active.has(e.projectId)) active.set(e.projectId, new Map());
    active.get(e.projectId).set(e.sessionId, e.ts);
    resolveName(e.projectId, e.userId)
      .then((name) => {
        e.name = name;
        const r = recent.get(e.projectId) || [];
        r.push(e);
        if (r.length > RECENT_MAX) r.shift();
        recent.set(e.projectId, r);
        bus.emit('event', e);
      })
      .catch((err) => console.error('[live] enrich error', err.message));
  } catch (err) {
    console.error('[live] publishEvent error', err.message);
  }
}

// ---- Recordings: which users currently have an rrweb session being recorded ----
// Fed by the record ingest (not the events collection), keyed by userId so we never
// depend on Event.sessionId and Session.sessionId being the same value.
const recordings = new Map(); // projectId -> Map(userId -> { userId, sessionId, ts })

function recordingList(projectId) {
  const m = recordings.get(projectId);
  if (!m) return [];
  const cutoff = Date.now() - WINDOW_MS;
  return [...m.values()].filter((r) => r.ts >= cutoff);
}

// Call (without await) after an rrweb chunk is saved. Never throws.
function publishRecording({ projectId, sessionId, userId }) {
  try {
    const pid = String(projectId || '');
    if (!pid || !sessionId || !userId) return; // guests are not recorded
    if (!recordings.has(pid)) recordings.set(pid, new Map());
    const r = { userId: String(userId), sessionId: String(sessionId), ts: Date.now() };
    recordings.get(pid).set(r.userId, r);
    bus.emit('recording', { projectId: pid, ...r });
  } catch (err) {
    console.error('[live] publishRecording error', err.message);
  }
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// GET /live/stream?projectId=...
// NOTE: EventSource can't send custom headers, so requireProject must accept ?projectId=.
function streamHandler(req, res) {
  const projectId = req.projectId || req.query.projectId; // set by requireProject
  if (!projectId) return res.status(400).json({ error: 'projectId required' });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const client = { res, projectId: String(projectId) };
  clients.add(client);
  send(res, 'snapshot', {
    events: recent.get(client.projectId) || [],
    active: activeCount(client.projectId),
    recordings: recordingList(client.projectId),
  });

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

// Fan out events to connected dashboards
bus.on('event', (e) => {
  for (const c of clients) if (c.projectId === e.projectId) send(c.res, 'live', e);
});
bus.on('recording', (r) => {
  for (const c of clients) if (c.projectId === r.projectId) send(c.res, 'recording', r);
});

// Every 3s: prune stale sessions and broadcast active-user counts
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const m of active.values()) for (const [sid, t] of m) if (t < cutoff) m.delete(sid);
  for (const m of recordings.values()) for (const [u, r] of m) if (r.ts < cutoff) m.delete(u);
  const pids = new Set([...clients].map((c) => c.projectId));
  for (const pid of pids) {
    const payload = { active: activeCount(pid), ts: Date.now() };
    for (const c of clients) if (c.projectId === pid) send(c.res, 'stats', payload);
  }
}, 3000);

module.exports = { publishEvent, publishRecording, getActiveCount: activeCount, streamHandler };

/* ---- Wiring ----
// routes/admin.js: add BELOW router.use(requireProject)
const { streamHandler } = require('../services/liveService');
router.get('/live/stream', streamHandler);

// controllers/eventsController.js, in ingestEvents, right after Event.insertMany:
const { publishEvent } = require('../services/liveService');
const result = await Event.insertMany(documents, { ordered: false });
result.forEach(publishEvent); // fire-and-forget, never throws

// controllers/recordController.js, in ingestSession, right after the chunk is saved:
const { publishRecording } = require('../services/liveService');
publishRecording({ projectId: req.projectId, sessionId, userId }); // use the values you saved the chunk with
*/
