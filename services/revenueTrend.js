const Event = require('../models/Event');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
  applyPersonaFilter,
} = require('./filterHelpers');

function resolveBucketing(start, end) {
  const spanDays = (end - start) / (24 * 60 * 60 * 1000);
  if (spanDays <= 2) return { format: '%Y-%m-%d %H:00' };
  if (spanDays <= 45) return { format: '%Y-%m-%d' };
  if (spanDays <= 120) return { format: '%Y-%U' };
  return { format: '%Y-%m' };
}

async function getRevenueTrend({
  projectId,
  period = '30d',
  customRange,
  personas = [],
  platform = 'combined',
  device,
}) {
  const { start, end } = resolveDateRange(period, customRange);
  const { format } = resolveBucketing(start, end);

  const match = {
    projectId,
    event: 'purchase',
    timestamp: { $gte: start, $lt: end },
  };
  applyPlatformDeviceFilter(match, platform, device);

  const personaFilter = await getPersonaUserIds(projectId, personas, start, end);
  applyPersonaFilter(match, personaFilter);

  const rows = await Event.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format, date: '$timestamp' } },
        revenue: {
          $sum: {
            $convert: { input: '$properties.total', to: 'double', onError: 0, onNull: 0 },
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Frontend chart currently expects value in thousands.
  return rows.map((row) => ({ label: row._id, value: Math.round(row.revenue / 1000) }));
}

module.exports = { getRevenueTrend, resolveBucketing };
