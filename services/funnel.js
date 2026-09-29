const Event = require('../models/Event');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
  applyPersonaFilter,
} = require('./filterHelpers');

const isProductDetailPath = (path) =>
  typeof path === 'string' && /^\/products-detail\//.test(path);

const FUNNEL_DEFINITIONS = {
  direct: {
    id: 'direct',
    name: 'Direct to Cart',
    description: 'PLP → Add to Cart → Cart → Checkout → Purchase',
    steps: [
      { step: 'PLP', event: 'view_item_list' },
      // A direct PLP add must actually originate on the product-list page.
      // Without this path check, sessions that went through PDP were also
      // counted in the "direct" funnel because extra events were ignored.
      { step: 'Add to Cart', event: 'add_to_cart', pathTest: (path) => path === '/products' },
      { step: 'Cart', event: 'view_cart' },
      { step: 'Checkout', event: 'checkout_start' },
      { step: 'Purchase', event: 'purchase' },
    ],
  },

  viaPdp: {
    id: 'viaPdp',
    name: 'Via Product Detail',
    description: 'PLP → PDP → Add to Cart → Cart → Checkout → Purchase',
    steps: [
      { step: 'PLP', event: 'view_item_list' },
      { step: 'PDP', event: 'product_view', pathTest: isProductDetailPath },
      { step: 'Add to Cart', event: 'add_to_cart', pathTest: isProductDetailPath },
      { step: 'Cart', event: 'view_cart' },
      { step: 'Checkout', event: 'checkout_start' },
      { step: 'Purchase', event: 'purchase' },
    ],
  },
};

const ALL_FUNNEL_EVENTS = [
  ...new Set(
    Object.values(FUNNEL_DEFINITIONS)
      .flatMap((funnel) => funnel.steps.map((step) => step.event))
  ),
];

/**
 * Fetch only the fields required for funnel progression and group them by
 * session. Project/time/persona/device scoping is already present in baseMatch.
 */
async function getSessionEvents(baseMatch) {
  const rows = await Event.aggregate([
    {
      $match: {
        ...baseMatch,
        event: { $in: ALL_FUNNEL_EVENTS },
      },
    },
    { $sort: { sessionId: 1, timestamp: 1 } },
    { $project: { _id: 0, sessionId: 1, event: 1, path: 1 } },
  ]);

  const sessions = new Map();
  for (const row of rows) {
    if (!row.sessionId) continue;
    if (!sessions.has(row.sessionId)) sessions.set(row.sessionId, []);
    sessions.get(row.sessionId).push({ event: row.event, path: row.path || '' });
  }
  return sessions;
}

function matchesStep(actual, step) {
  if (!actual || actual.event !== step.event) return false;
  if (step.path && actual.path !== step.path) return false;
  if (step.pathTest && !step.pathTest(actual.path)) return false;
  return true;
}

/**
 * Return how many ordered funnel steps a session reached. Unrelated events are
 * ignored, but a step is accepted only when its optional path constraint also
 * matches.
 */
function getProgress(events, requiredSteps) {
  let requiredIndex = 0;
  for (const actual of events) {
    if (matchesStep(actual, requiredSteps[requiredIndex])) {
      requiredIndex += 1;
      if (requiredIndex === requiredSteps.length) break;
    }
  }
  return requiredIndex;
}

function calculateFunnel(sessions, definition) {
  const counts = new Array(definition.steps.length).fill(0);

  for (const events of sessions.values()) {
    const progress = getProgress(events, definition.steps);
    for (let i = 0; i < progress; i += 1) counts[i] += 1;
  }

  const steps = definition.steps.map((step, index) => {
    const value = counts[index];
    const previousValue = index > 0 ? counts[index - 1] : null;
    const retention = index === 0
      ? 100
      : previousValue > 0
        ? +((value / previousValue) * 100).toFixed(1)
        : 0;
    const dropoff = index === 0 || previousValue <= 0
      ? 0
      : +(100 - retention).toFixed(1);

    return { step: step.step, event: step.event, value, retention, dropoff };
  });

  const first = counts[0] || 0;
  const last = counts[counts.length - 1] || 0;

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    steps,
    conversionRate: first > 0 ? +((last / first) * 100).toFixed(1) : 0,
    entrySessions: first,
    convertedSessions: last,
  };
}

async function getFunnel({
  projectId,
  period = '30d',
  customRange,
  personas = [],
  platform = 'combined',
  device,
}) {
  if (!projectId) throw new Error('projectId is required');

  const { start, end } = resolveDateRange(period, customRange);
  const baseMatch = {
    projectId,
    timestamp: { $gte: start, $lt: end },
  };

  applyPlatformDeviceFilter(baseMatch, platform, device);
  const personaFilter = await getPersonaUserIds(projectId, personas, start, end);
  applyPersonaFilter(baseMatch, personaFilter);

  const sessions = await getSessionEvents(baseMatch);
  const direct = calculateFunnel(sessions, FUNNEL_DEFINITIONS.direct);
  const viaPdp = calculateFunnel(sessions, FUNNEL_DEFINITIONS.viaPdp);

  return {
    totalSessions: sessions.size,
    funnels: { direct, viaPdp },
  };
}

module.exports = {
  getFunnel,
  FUNNEL_DEFINITIONS,
  calculateFunnel,
  getProgress,
};
