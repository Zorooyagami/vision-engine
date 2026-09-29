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
  events.forEach((event) => { EVENT_TO_NODE[event] = node; });
}
const ALL_PATH_EVENTS = Object.keys(EVENT_TO_NODE);

function collapseConsecutive(nodes) {
  const out = [];
  for (const node of nodes) {
    if (out[out.length - 1] !== node) out.push(node);
  }
  return out;
}

function truncateAtPurchase(nodes) {
  const index = nodes.indexOf('Purchase');
  return index === -1 ? nodes : nodes.slice(0, index + 1);
}

async function getSessionSequences(match) {
  const rows = await Event.aggregate([
    { $match: { ...match, event: { $in: ALL_PATH_EVENTS } } },
    { $sort: { sessionId: 1, timestamp: 1 } },
    { $project: { sessionId: 1, event: 1 } },
  ]);

  const bySession = new Map();
  for (const row of rows) {
    if (!row.sessionId) continue;
    if (!bySession.has(row.sessionId)) bySession.set(row.sessionId, []);
    bySession.get(row.sessionId).push(EVENT_TO_NODE[row.event]);
  }

  const sequences = new Map();
  for (const [sessionId, nodes] of bySession) {
    sequences.set(sessionId, truncateAtPurchase(collapseConsecutive(nodes)));
  }
  return sequences;
}

async function getRevenueBySession(match) {
  const rows = await Event.aggregate([
    { $match: { ...match, event: 'purchase' } },
    {
      $group: {
        _id: '$sessionId',
        revenue: {
          $sum: {
            $convert: { input: '$properties.total', to: 'double', onError: 0, onNull: 0 },
          },
        },
      },
    },
  ]);
  return new Map(rows.map((row) => [row._id, row.revenue || 0]));
}

async function createBaseMatch({ projectId, period, customRange, personas, platform, device }) {
  const { start, end } = resolveDateRange(period, customRange);
  const baseMatch = { projectId, timestamp: { $gte: start, $lt: end } };
  applyPlatformDeviceFilter(baseMatch, platform, device);
  const personaFilter = await getPersonaUserIds(projectId, personas, start, end);
  applyPersonaFilter(baseMatch, personaFilter);
  return baseMatch;
}

async function getTopPaths({
  projectId,
  period = '30d',
  customRange,
  personas = [],
  platform = 'combined',
  device,
  limit = 4,
}) {
  const baseMatch = await createBaseMatch({ projectId, period, customRange, personas, platform, device });
  const [sequences, revenueBySession] = await Promise.all([
    getSessionSequences(baseMatch),
    getRevenueBySession(baseMatch),
  ]);
  const totalSessions = sequences.size;

  const groups = new Map();
  for (const [sessionId, nodes] of sequences) {
    if (!nodes.length) continue;
    const key = nodes.join('>');
    if (!groups.has(key)) {
      groups.set(key, {
        nodes,
        sessionIds: [],
        endsInPurchase: nodes[nodes.length - 1] === 'Purchase',
      });
    }
    groups.get(key).sessionIds.push(sessionId);
  }

  const totalPurchasers = [...groups.values()]
    .filter((group) => group.endsInPurchase)
    .reduce((sum, group) => sum + group.sessionIds.length, 0);

  const paths = [...groups.values()].map((group) => {
    const count = group.sessionIds.length;
    const revenue = group.endsInPurchase
      ? group.sessionIds.reduce((sum, id) => sum + (revenueBySession.get(id) || 0), 0)
      : 0;

    return {
      path: group.nodes.join(' → ') + (group.endsInPurchase ? '' : ' → Exit'),
      nodes: group.nodes,
      sessionCount: count,
      endsInPurchase: group.endsInPurchase,
      pctOfTotalSessions: totalSessions ? +((count / totalSessions) * 100).toFixed(1) : 0,
      pctOfPurchasers:
        group.endsInPurchase && totalPurchasers
          ? +((count / totalPurchasers) * 100).toFixed(1)
          : null,
      revenue: Math.round(revenue),
    };
  });

  paths.sort((a, b) => b.sessionCount - a.sessionCount);
  return { totalSessions, totalPurchasers, topPaths: paths.slice(0, Math.max(1, Math.min(Number(limit) || 4, 20))) };
}

async function getPathDetail({
  projectId,
  period = '30d',
  customRange,
  personas = [],
  platform = 'combined',
  device,
  pathNodes,
}) {
  const baseMatch = await createBaseMatch({ projectId, period, customRange, personas, platform, device });
  const [sequences, revenueBySession] = await Promise.all([
    getSessionSequences(baseMatch),
    getRevenueBySession(baseMatch),
  ]);

  const targetKey = pathNodes.join('>');
  const matchingSessionIds = [];
  for (const [sessionId, nodes] of sequences) {
    if (nodes.join('>') === targetKey) matchingSessionIds.push(sessionId);
  }

  const stepCounts = pathNodes.map((_, index) => {
    const prefixKey = pathNodes.slice(0, index + 1).join('>');
    let count = 0;
    for (const nodes of sequences.values()) {
      if (nodes.slice(0, index + 1).join('>') === prefixKey) count += 1;
    }
    return count;
  });

  const steps = pathNodes.map((node, index) => ({
    node,
    count: stepCounts[index],
    retentionFromPrevious:
      index === 0
        ? 100
        : stepCounts[index - 1]
          ? +((stepCounts[index] / stepCounts[index - 1]) * 100).toFixed(1)
          : 0,
  }));

  const endsInPurchase = pathNodes[pathNodes.length - 1] === 'Purchase';
  const revenue = endsInPurchase
    ? matchingSessionIds.reduce((sum, id) => sum + (revenueBySession.get(id) || 0), 0)
    : 0;

  return {
    path: pathNodes.join(' → '),
    steps,
    users: matchingSessionIds.length,
    revenue: Math.round(revenue),
    conversion: stepCounts[0]
      ? +((stepCounts[stepCounts.length - 1] / stepCounts[0]) * 100).toFixed(1)
      : 0,
  };
}

async function getJourneyFlow({
  projectId,
  period = '30d',
  customRange,
  personas = [],
  platform = 'combined',
  device,
}) {
  const baseMatch = await createBaseMatch({ projectId, period, customRange, personas, platform, device });
  const sequences = await getSessionSequences(baseMatch);
  const totalSessions = sequences.size;
  const nodeCounts = {};
  const edgeCounts = {};

  for (const nodes of sequences.values()) {
    if (!nodes.length) continue;
    new Set(nodes).forEach((node) => {
      nodeCounts[node] = (nodeCounts[node] || 0) + 1;
    });

    const seenEdges = new Set();
    for (let index = 0; index < nodes.length - 1; index += 1) {
      seenEdges.add(`${nodes[index]}>${nodes[index + 1]}`);
    }
    if (nodes[nodes.length - 1] !== 'Purchase') {
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
