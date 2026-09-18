// services/journeyPaths.js
const Event = require('../models/Event');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
  applyPersonaFilter,
} = require('./filterHelpers');

const NODE_EVENT_MAP = {
  PLP: ['view_item_list'],
  PDP: ['product_view'],
  'Add to Cart': ['add_to_cart'],
  Cart: ['view_cart'],
  Checkout: ['checkout_start'],
  Shipping: ['shipping_details'],
  Purchase: ['purchase'],
};

const EVENT_TO_NODE = {};
for (const [node, events] of Object.entries(NODE_EVENT_MAP)) {
  events.forEach((e) => { EVENT_TO_NODE[e] = node; });
}
const ALL_PATH_EVENTS = Object.keys(EVENT_TO_NODE);

function collapseConsecutive(nodes) {
  const out = [];
  for (const n of nodes) {
    if (out[out.length - 1] !== n) out.push(n);
  }
  return out;
}

// Once a session reaches Purchase, the funnel is complete — anything the
// user does afterward (browsing more products, viewing order confirmation,
// etc.) isn't part of the conversion journey and must not appear as a
// further transition (e.g. a nonsensical "Purchase → PDP" edge).
function truncateAtPurchase(nodes) {
  const idx = nodes.indexOf('Purchase');
  return idx === -1 ? nodes : nodes.slice(0, idx + 1);
}

async function getSessionSequences(match) {
  const rows = await Event.aggregate([
    { $match: { ...match, event: { $in: ALL_PATH_EVENTS } } },
    { $sort: { sessionId: 1, timestamp: 1 } },
    { $project: { sessionId: 1, event: 1, timestamp: 1 } },
  ]);

  const bySession = new Map();
  for (const row of rows) {
    if (!bySession.has(row.sessionId)) bySession.set(row.sessionId, []);
    bySession.get(row.sessionId).push(EVENT_TO_NODE[row.event]);
  }

  const sequences = new Map();
  for (const [sessionId, nodes] of bySession) {
    const collapsed = collapseConsecutive(nodes);
    sequences.set(sessionId, truncateAtPurchase(collapsed));
  }
  return sequences;
}

async function getRevenueForSessions(sessionIds, match) {
  if (!sessionIds.length) return 0;
  const rows = await Event.aggregate([
    { $match: { ...match, event: 'purchase', sessionId: { $in: sessionIds } } },
    {
      $group: {
        _id: null,
        revenue: { $sum: { $convert: { input: '$properties.total', to: 'double', onError: 0, onNull: 0 } } },
      },
    },
  ]);
  return rows[0]?.revenue || 0;
}

async function getTopPaths({ period = '30d', customRange, personas = [], platform = 'combined', device, limit = 4 }) {
  const { start, end } = resolveDateRange(period, customRange);
  const baseMatch = { timestamp: { $gte: start, $lt: end } };
  applyPlatformDeviceFilter(baseMatch, platform, device);

  const personaFilter = await getPersonaUserIds(personas, start, end);
  applyPersonaFilter(baseMatch, personaFilter);

  const sequences = await getSessionSequences(baseMatch);
  const totalSessions = sequences.size;

  const groups = new Map();
  for (const [sessionId, nodes] of sequences) {
    if (!nodes.length) continue;
    const key = nodes.join('>');
    if (!groups.has(key)) {
      groups.set(key, { nodes, sessionIds: [], endsInPurchase: nodes[nodes.length - 1] === 'Purchase' });
    }
    groups.get(key).sessionIds.push(sessionId);
  }

  const totalPurchasers = [...groups.values()]
    .filter((g) => g.endsInPurchase)
    .reduce((sum, g) => sum + g.sessionIds.length, 0);

  const paths = [];
  for (const group of groups.values()) {
    const count = group.sessionIds.length;
    const revenue = group.endsInPurchase
      ? await getRevenueForSessions(group.sessionIds, baseMatch)
      : 0;

    const displayPath = group.nodes.join(' → ') + (group.endsInPurchase ? '' : ' → Exit');

    paths.push({
      path: displayPath,
      nodes: group.nodes,
      sessionCount: count,
      endsInPurchase: group.endsInPurchase,
      pctOfTotalSessions: totalSessions ? +((count / totalSessions) * 100).toFixed(1) : 0,
      pctOfPurchasers:
        group.endsInPurchase && totalPurchasers ? +((count / totalPurchasers) * 100).toFixed(1) : null,
      revenue: Math.round(revenue),
    });
  }

  paths.sort((a, b) => b.sessionCount - a.sessionCount);

  return { totalSessions, totalPurchasers, topPaths: paths.slice(0, limit) };
}

async function getPathDetail({ period = '30d', customRange, personas = [], platform = 'combined', device, pathNodes }) {
  const { start, end } = resolveDateRange(period, customRange);
  const baseMatch = { timestamp: { $gte: start, $lt: end } };
  applyPlatformDeviceFilter(baseMatch, platform, device);

  const personaFilter = await getPersonaUserIds(personas, start, end);
  applyPersonaFilter(baseMatch, personaFilter);

  const sequences = await getSessionSequences(baseMatch);

  const targetKey = pathNodes.join('>');
  const matchingSessionIds = [];
  for (const [sessionId, nodes] of sequences) {
    if (nodes.join('>') === targetKey) matchingSessionIds.push(sessionId);
  }

  const stepCounts = pathNodes.map((_, i) => {
    const prefixKey = pathNodes.slice(0, i + 1).join('>');
    let count = 0;
    for (const nodes of sequences.values()) {
      if (nodes.slice(0, i + 1).join('>') === prefixKey) count++;
    }
    return count;
  });

  const steps = pathNodes.map((node, i) => ({
    node,
    count: stepCounts[i],
    retentionFromPrevious:
      i === 0 ? 100 : stepCounts[i - 1] ? +((stepCounts[i] / stepCounts[i - 1]) * 100).toFixed(1) : 0,
  }));

  const endsInPurchase = pathNodes[pathNodes.length - 1] === 'Purchase';
  const revenue = endsInPurchase ? await getRevenueForSessions(matchingSessionIds, baseMatch) : 0;

  return {
    path: pathNodes.join(' → '),
    steps,
    users: matchingSessionIds.length,
    revenue: Math.round(revenue),
    conversion: stepCounts[0] ? +((stepCounts[stepCounts.length - 1] / stepCounts[0]) * 100).toFixed(1) : 0,
  };
}

// Full node-to-node flow across ALL sessions, not just the top-ranked paths.
async function getJourneyFlow({ period = '30d', customRange, personas = [], platform = 'combined', device }) {
  const { start, end } = resolveDateRange(period, customRange);
  const baseMatch = { timestamp: { $gte: start, $lt: end } };
  applyPlatformDeviceFilter(baseMatch, platform, device);

  const personaFilter = await getPersonaUserIds(personas, start, end);
  applyPersonaFilter(baseMatch, personaFilter);

  const sequences = await getSessionSequences(baseMatch);
  const totalSessions = sequences.size;

  const nodeCounts = {};
  const edgeCounts = {};

  for (const nodes of sequences.values()) {
    if (!nodes.length) continue;

    const seenNodes = new Set(nodes);
    seenNodes.forEach((n) => {
      nodeCounts[n] = (nodeCounts[n] || 0) + 1;
    });

    const seenEdges = new Set();
    for (let i = 0; i < nodes.length - 1; i++) {
      const key = `${nodes[i]}>${nodes[i + 1]}`;
      seenEdges.add(key);
    }

    const endsInPurchase = nodes[nodes.length - 1] === 'Purchase';
    if (!endsInPurchase) {
      seenEdges.add(`${nodes[nodes.length - 1]}>Exit`);
    }

    seenEdges.forEach((key) => {
      edgeCounts[key] = (edgeCounts[key] || 0) + 1;
    });
  }

  nodeCounts.Exit = Object.entries(edgeCounts)
    .filter(([key]) => key.endsWith('>Exit'))
    .reduce((sum, [, count]) => sum + count, 0);

  const fromTotals = {};
  Object.entries(edgeCounts).forEach(([key, count]) => {
    const from = key.split('>')[0];
    fromTotals[from] = (fromTotals[from] || 0) + count;
  });

  const edges = Object.entries(edgeCounts).map(([key, users]) => {
    const [from, to] = key.split('>');
    return {
      from,
      to,
      users,
      pct: fromTotals[from] ? Math.round((users / fromTotals[from]) * 100) : 0,
    };
  });

  return { totalSessions, nodes: nodeCounts, edges };
}

module.exports = { getTopPaths, getPathDetail, getJourneyFlow, NODE_EVENT_MAP };