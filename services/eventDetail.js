const Event = require('../models/Event');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
} = require('./filterHelpers');

function discoverPropertySchema(events) {
  const seen = new Map();
  events.forEach((event) => {
    Object.entries(event.properties || {}).forEach(([key, value]) => {
      if (!seen.has(key)) seen.set(key, Array.isArray(value) ? 'array' : typeof value);
    });
  });
  return [...seen.entries()].map(([key, type]) => ({ key, type }));
}

async function getEventDetail({
  projectId,
  eventName,
  period = '30d',
  customRange,
  platform = 'combined',
  device,
}) {
  const { start, end } = resolveDateRange(period, customRange);
  const windowMatch = { projectId, timestamp: { $gte: start, $lt: end } };
  applyPlatformDeviceFilter(windowMatch, platform, device);

  const [loyalFilter, firsttimeFilter, activeFilter, samples] = await Promise.all([
    getPersonaUserIds(projectId, ['loyal'], start, end),
    getPersonaUserIds(projectId, ['firsttime'], start, end),
    getPersonaUserIds(projectId, ['active'], start, end),
    Event.find({ ...windowMatch, event: eventName })
      .sort({ timestamp: -1 })
      .limit(20)
      .select('properties')
      .lean(),
  ]);

  const loyal = [...(loyalFilter?.ids || [])];
  const firsttime = [...(firsttimeFilter?.ids || [])];
  const active = [...(activeFilter?.ids || [])];

  const counts = await Event.aggregate([
    { $match: { ...windowMatch, event: eventName } },
    {
      $group: {
        _id: null,
        loyal: { $sum: { $cond: [{ $in: ['$userId', loyal] }, 1, 0] } },
        firsttime: { $sum: { $cond: [{ $in: ['$userId', firsttime] }, 1, 0] } },
        active: { $sum: { $cond: [{ $in: ['$userId', active] }, 1, 0] } },
        guest: { $sum: { $cond: [{ $eq: ['$userId', null] }, 1, 0] } },
      },
    },
  ]);

  const raw = {
    loyal: counts[0]?.loyal || 0,
    firsttime: counts[0]?.firsttime || 0,
    active: counts[0]?.active || 0,
    guest: counts[0]?.guest || 0,
  };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  const personaBreakdown = ['loyal', 'firsttime', 'active', 'guest'].map((id) => ({
    id,
    count: raw[id],
    share: total ? Math.round((raw[id] / total) * 100) : 0,
  }));

  return { personaBreakdown, properties: discoverPropertySchema(samples) };
}

module.exports = { getEventDetail };
