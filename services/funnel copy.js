// services/funnel.js
const Event = require('../models/Event');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
  applyPersonaFilter,
} = require('./filterHelpers');

const STEP_EVENT_MAP = {
  'Product Viewed': 'product_view',
  'Add to Cart': 'add_to_cart',
  'Checkout Started': 'checkout_start',
  'Purchase': 'purchase',
};
const STEPS = Object.keys(STEP_EVENT_MAP);

async function countDistinctSessions(eventName, baseMatch) {
  const rows = await Event.aggregate([
    { $match: { ...baseMatch, event: eventName } },
    { $group: { _id: '$sessionId' } },
    { $count: 'count' },
  ]);
  return rows[0]?.count || 0;
}

async function getFunnel({ period = '30d', customRange, personas = [], platform = 'combined', device }) {
  const { start, end } = resolveDateRange(period, customRange);

  const baseMatch = { timestamp: { $gte: start, $lt: end } };
  applyPlatformDeviceFilter(baseMatch, platform, device);

  const personaFilter = await getPersonaUserIds(personas, start, end);
  applyPersonaFilter(baseMatch, personaFilter);

  const steps = await Promise.all(
    STEPS.map(async (step) => {
      const eventName = STEP_EVENT_MAP[step];

      // main value respects platform/device filter as passed in
      const value = await countDistinctSessions(eventName, baseMatch);

      // web/app breakdown — only meaningful when not already device-filtered
      let web = null;
      let app = null;
      if (!device && platform === 'combined') {
        const webMatch = { ...baseMatch, 'deviceInfo.deviceType': 'Desktop' };
        const appMatch = { ...baseMatch, 'deviceInfo.deviceType': { $in: ['Mobile', 'Tablet'] } };
        [web, app] = await Promise.all([
          countDistinctSessions(eventName, webMatch),
          countDistinctSessions(eventName, appMatch),
        ]);
      }

      return { step, value, web, app };
    })
  );

  return steps;
}

module.exports = { getFunnel, STEPS };