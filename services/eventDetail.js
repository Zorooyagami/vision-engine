const Event = require('../models/Event');
const { resolveDateRange, applyPlatformDeviceFilter } = require('./filterHelpers');
const { getLoyalUserIds } = require('./aggregations');

async function classifyPersonas(start, end) {
  const [loyalIds, firstTimeRows, activeRows] = await Promise.all([
    getLoyalUserIds(),
    Event.aggregate([
      { $match: { event: 'sign_up', timestamp: { $gte: start, $lt: end }, userId: { $ne: null } } },
      { $group: { _id: '$userId' } },
    ]),
    Event.aggregate([
      { $match: { event: 'login', timestamp: { $gte: start, $lt: end }, userId: { $ne: null } } },
      { $group: { _id: '$userId' } },
    ]),
  ]);

  const firsttime = firstTimeRows.map((r) => r._id).filter((id) => !loyalIds.has(id));
  const active = activeRows.map((r) => r._id).filter((id) => !loyalIds.has(id) && !firsttime.includes(id));

  return { loyal: [...loyalIds], firsttime, active };
}

async function getPersonaBreakdown(eventName, windowMatch, start, end) {
  const { loyal, firsttime, active } = await classifyPersonas(start, end);

  const [loyalCount, firsttimeCount, activeCount, guestCount] = await Promise.all([
    Event.countDocuments({ ...windowMatch, event: eventName, userId: { $in: loyal } }),
    Event.countDocuments({ ...windowMatch, event: eventName, userId: { $in: firsttime } }),
    Event.countDocuments({ ...windowMatch, event: eventName, userId: { $in: active } }),
    Event.countDocuments({ ...windowMatch, event: eventName, userId: null }),
  ]);

  const total = loyalCount + firsttimeCount + activeCount + guestCount;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  return [
    { id: 'loyal', count: loyalCount, share: pct(loyalCount) },
    { id: 'firsttime', count: firsttimeCount, share: pct(firsttimeCount) },
    { id: 'active', count: activeCount, share: pct(activeCount) },
    { id: 'guest', count: guestCount, share: pct(guestCount) },
  ];
}

async function getSampleProperties(eventName) {
  const samples = await Event.find({ event: eventName }).sort({ timestamp: -1 }).limit(20).select('properties').lean();

  const seen = new Map(); // key -> type
  samples.forEach((doc) => {
    const props = doc.properties || {};
    Object.entries(props).forEach(([key, value]) => {
      if (!seen.has(key)) {
        seen.set(key, Array.isArray(value) ? 'array' : typeof value);
      }
    });
  });

  return [...seen.entries()].map(([key, type]) => ({ key, type }));
}

async function getEventDetail({ eventName, period = '30d', customRange, platform = 'combined', device }) {
  const { start, end } = resolveDateRange(period, customRange);
  const windowMatch = { timestamp: { $gte: start, $lt: end } };
  applyPlatformDeviceFilter(windowMatch, platform, device);

  const [personaBreakdown, properties] = await Promise.all([
    getPersonaBreakdown(eventName, windowMatch, start, end),
    getSampleProperties(eventName),
  ]);

  return { personaBreakdown, properties };
}

module.exports = { getEventDetail };