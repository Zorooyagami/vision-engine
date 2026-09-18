const Event = require('../models/Event');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
  applyPersonaFilter,
} = require('./filterHelpers');

const FUNNEL_DEFINITIONS = {
  direct: {
    id: 'direct',
    name: 'Direct to Cart',
    description: 'PLP → Add to Cart → Cart → Checkout → Purchase',
    steps: [
      { step: 'PLP', event: 'view_item_list' },
      { step: 'Add to Cart', event: 'add_to_cart' },
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
      { step: 'PDP', event: 'product_view' },
      { step: 'Add to Cart', event: 'add_to_cart' },
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
 * Get all relevant events grouped by session and ordered by timestamp.
 */
async function getSessionEvents(baseMatch) {
  const rows = await Event.aggregate([
    {
      $match: {
        ...baseMatch,
        event: { $in: ALL_FUNNEL_EVENTS },
      },
    },
    {
      $sort: {
        sessionId: 1,
        timestamp: 1,
      },
    },
    {
      $project: {
        sessionId: 1,
        event: 1,
        timestamp: 1,
      },
    },
  ]);

  const sessions = new Map();

  for (const row of rows) {
    if (!row.sessionId) continue;

    if (!sessions.has(row.sessionId)) {
      sessions.set(row.sessionId, []);
    }

    sessions.get(row.sessionId).push(row.event);
  }

  return sessions;
}

/**
 * Determine how far a session progressed through a funnel.
 *
 * Example:
 *
 * required:
 * PLP → PDP → Add to Cart → Cart → Checkout → Purchase
 *
 * actual:
 * PLP → PDP → PDP → Add to Cart → Cart
 *
 * returns 4 because the session successfully reached:
 * PLP
 * PDP
 * Add to Cart
 * Cart
 */
function getProgress(events, requiredEvents) {
  let requiredIndex = 0;

  for (const event of events) {
    if (event === requiredEvents[requiredIndex]) {
      requiredIndex += 1;

      if (requiredIndex === requiredEvents.length) {
        break;
      }
    }
  }

  return requiredIndex;
}

function calculateFunnel(sessions, definition) {
  const requiredEvents = definition.steps.map((step) => step.event);

  const counts = new Array(requiredEvents.length).fill(0);

  for (const events of sessions.values()) {
    const progress = getProgress(events, requiredEvents);

    /*
     * If progress = 3, the session reached:
     *
     * step 0
     * step 1
     * step 2
     *
     * Therefore increment all three.
     */
    for (let i = 0; i < progress; i += 1) {
      counts[i] += 1;
    }
  }

  const steps = definition.steps.map((step, index) => {
    const value = counts[index];

    const previousValue =
      index > 0
        ? counts[index - 1]
        : null;

    const retention =
      index === 0
        ? 100
        : previousValue > 0
          ? +((value / previousValue) * 100).toFixed(1)
          : 0;

    const dropoff =
      index === 0
        ? 0
        : previousValue > 0
          ? +(100 - retention).toFixed(1)
          : 0;

    return {
      step: step.step,
      event: step.event,
      value,
      retention,
      dropoff,
    };
  });

  const first = counts[0] || 0;
  const last = counts[counts.length - 1] || 0;

  const conversionRate =
    first > 0
      ? +((last / first) * 100).toFixed(1)
      : 0;

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    steps,
    conversionRate,
    entrySessions: first,
    convertedSessions: last,
  };
}

async function getFunnel({
  period = '30d',
  customRange,
  personas = [],
  platform = 'combined',
  device,
}) {
  const { start, end } = resolveDateRange(period, customRange);

  const baseMatch = {
    timestamp: {
      $gte: start,
      $lt: end,
    },
  };

  applyPlatformDeviceFilter(
    baseMatch,
    platform,
    device
  );

  const personaFilter =
    await getPersonaUserIds(
      personas,
      start,
      end
    );

  applyPersonaFilter(
    baseMatch,
    personaFilter
  );

  const sessions =
    await getSessionEvents(baseMatch);

  const direct = calculateFunnel(
    sessions,
    FUNNEL_DEFINITIONS.direct
  );

  const viaPdp = calculateFunnel(
    sessions,
    FUNNEL_DEFINITIONS.viaPdp
  );

  return {
    totalSessions: sessions.size,

    funnels: {
      direct,
      viaPdp,
    },
  };
}

module.exports = {
  getFunnel,
  FUNNEL_DEFINITIONS,
};