/**
 * Idle-time compression for rrweb recordings.
 *
 * A recording's timeline is wall-clock time, so a user who walks away (or a
 * route that isn't recorded, where recording stops and restarts later) leaves
 * minutes of dead air: the duration is inflated and playback sits on a frozen
 * screen. rrweb's skipInactive only fast-forwards those gaps, it does not
 * remove them. Here the gaps are removed from the timestamps themselves.
 *
 * "Activity" follows rrweb's own definition (mouse move/click, scroll, input),
 * plus touch-move and drag. DOM mutations alone do not count: a page that
 * animates by itself is still idle.
 *
 * Within an idle stretch the first LEAD_MS play at real speed (so the page's
 * immediate reaction to the last action, e.g. a route change rendering, is
 * unchanged); the remainder is squeezed into KEEP_MS.
 *
 * KEEP IN SYNC with dashboard/src/components/tools/replay/replayTimeline.js.
 */

const IDLE_THRESHOLD_MS = 6000
const LEAD_MS = 1500
const KEEP_MS = 500

const ACTIVE_SOURCES = new Set([1, 2, 3, 5, 6, 12])
const isActivity = (event) => event?.type === 3 && ACTIVE_SOURCES.has(event?.data?.source)

function compressIdleTime(rawEvents) {
  const events = (Array.isArray(rawEvents) ? rawEvents : [])
    .filter((e) => e && Number.isFinite(e.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)

  if (events.length < 2) {
    const t = events[0]?.timestamp ?? null
    return { events, recordedMs: 0, activeMs: 0, idleRemovedMs: 0, firstTs: t, lastTs: t }
  }

  const first = events[0].timestamp
  const last = events[events.length - 1].timestamp

  // Boundaries: start, every activity timestamp, end.
  const marks = [first]
  for (const e of events) if (isActivity(e) && e.timestamp > marks[marks.length - 1]) marks.push(e.timestamp)
  if (last > marks[marks.length - 1]) marks.push(last)

  // Build idle spans and the cumulative time removed before each one.
  const spans = []
  let removed = 0
  for (let i = 0; i < marks.length - 1; i += 1) {
    const start = marks[i]
    const end = marks[i + 1]
    const gap = end - start
    if (gap > IDLE_THRESHOLD_MS) {
      const newGap = LEAD_MS + KEEP_MS
      spans.push({ start, end, gap, removedBefore: removed })
      removed += gap - newGap
    }
  }

  const mapTime = (t) => {
    // Binary search for the last span starting at or before t.
    let lo = 0
    let hi = spans.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (spans[mid].start <= t) {
        found = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    if (found === -1) return t
    const s = spans[found]
    if (t >= s.end) return t - (s.removedBefore + (s.gap - (LEAD_MS + KEEP_MS)))
    const offset = t - s.start
    const compressed =
      offset <= LEAD_MS ? offset : LEAD_MS + ((offset - LEAD_MS) * KEEP_MS) / (s.gap - LEAD_MS)
    return s.start - s.removedBefore + compressed
  }

  const mapped = events.map((e) => ({ ...e, timestamp: Math.round(mapTime(e.timestamp)) }))
  const recordedMs = last - first
  return {
    events: mapped,
    recordedMs,
    activeMs: Math.max(0, recordedMs - removed),
    idleRemovedMs: removed,
    firstTs: first,
    lastTs: last,
  }
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

/**
 * Compact summary of one chunk, stored at ingest so the list view never has to
 * decompress recordings and the session total matches the player exactly:
 *   spans   [start, end] runs of user activity (gaps <= IDLE_THRESHOLD_MS merged)
 *   firstTs / lastTs   first and last event of the chunk
 * Chunk edges are NOT activity marks; only the session's true first/last event are.
 */
function chunkSummary(rawEvents) {
  const events = (Array.isArray(rawEvents) ? rawEvents : []).filter((e) => e && Number.isFinite(e.timestamp));
  if (!events.length) return null;
  const sorted = events.slice().sort((a, b) => a.timestamp - b.timestamp);
  const marks = [];
  for (const e of sorted) {
    if (isActivity(e) && (!marks.length || e.timestamp > marks[marks.length - 1])) marks.push(e.timestamp);
  }
  const spans = [];
  let start = null;
  let prev = null;
  for (const m of marks) {
    if (start === null) {
      start = prev = m;
    } else if (m - prev <= IDLE_THRESHOLD_MS) {
      prev = m;
    } else {
      spans.push([start, prev]);
      start = prev = m;
    }
  }
  if (start !== null) spans.push([start, prev]);
  return { spans, firstTs: sorted[0].timestamp, lastTs: sorted[sorted.length - 1].timestamp };
}

/**
 * Active duration of a whole session from the per-chunk summaries.
 * Returns null when any chunk predates them (caller falls back).
 */
function sessionActiveMs(chunks) {
  if (!chunks?.length) return null;
  if (!chunks.every((c) => Array.isArray(c.spans) && Number.isFinite(c.firstTs) && Number.isFinite(c.lastTs))) return null;
  const first = Math.min(...chunks.map((c) => c.firstTs));
  const last = Math.max(...chunks.map((c) => c.lastTs));
  const all = [[first, first], [last, last], ...chunks.flatMap((c) => c.spans)].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let prevEnd = null;
  for (const [s0, e] of all) {
    let s = s0;
    if (prevEnd !== null) {
      const gap = s - prevEnd;
      if (gap > 0) total += gap <= IDLE_THRESHOLD_MS ? gap : LEAD_MS + KEEP_MS;
      else s = prevEnd;
    }
    total += Math.max(0, e - s);
    prevEnd = prevEnd === null ? e : Math.max(prevEnd, e);
  }
  return total;
}

module.exports = { compressIdleTime, chunkSummary, formatDuration, sessionActiveMs, IDLE_THRESHOLD_MS };
