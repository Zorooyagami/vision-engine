const Event = require('../models/Event');
const EventDefinition = require('../models/EventDefinition');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
  applyPersonaFilter,
} = require('./filterHelpers');

function inferCategory(name) {
  if (['view_item_list', 'product_view', 'search_performed', 'filter_applied', 'sort_changed', 'select_item', 'page_view', 'heatmap_click', 'heatmap_move'].includes(name)) return 'browsing';
  if (['add_to_cart', 'remove_from_cart', 'view_cart'].includes(name)) return 'cart';
  if (['checkout_start', 'shipping_details', 'purchase'].includes(name)) return 'checkout';
  return 'other';
}

async function ensureCatalogSeeded(projectId) {
  const [distinctNames, existing] = await Promise.all([
    Event.distinct('event', { projectId }),
    EventDefinition.find({ projectId }, { name: 1 }).lean(),
  ]);
  const existingNames = new Set(existing.map((row) => row.name));
  const missing = distinctNames.filter((name) => !existingNames.has(name));

  if (missing.length) {
    await EventDefinition.insertMany(
      missing.map((name) => ({
        projectId,
        name,
        category: inferCategory(name),
        description: '',
        status: 'Active',
      })),
      { ordered: false }
    ).catch((err) => {
      // Concurrent requests may seed the same definition. Ignore duplicate-key
      // races; surface anything else.
      if (err?.code !== 11000 && !err?.writeErrors?.every((e) => e.code === 11000)) throw err;
    });
  }
}

async function getEventCatalog({
  projectId,
  period = '30d',
  customRange,
  personas = [],
  platform = 'combined',
  device,
}) {
  await ensureCatalogSeeded(projectId);

  const { start, end } = resolveDateRange(period, customRange);
  const windowMatch = { projectId, timestamp: { $gte: start, $lt: end } };
  applyPlatformDeviceFilter(windowMatch, platform, device);
  const personaFilter = await getPersonaUserIds(projectId, personas, start, end);
  applyPersonaFilter(windowMatch, personaFilter);

  const definitions = await EventDefinition.find({ projectId }).sort({ name: 1 }).lean();

  // One aggregation replaces 2 queries per event definition.
  const metricsRows = await Event.aggregate([
    { $match: windowMatch },
    {
      $group: {
        _id: '$event',
        volume: { $sum: 1 },
        lastSeen: { $max: '$timestamp' },
      },
    },
  ]);
  const metrics = new Map(metricsRows.map((row) => [row._id, row]));

  // Build all 7-day sparklines in a single aggregation.
  // Anchor the sparkline to the selected range end. Using wall-clock "now"
  // made historical/custom-range event views show misleading empty sparklines.
  const sparkEnd = new Date(end);
  const sparkStart = new Date(sparkEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sparkMatch = { ...windowMatch, timestamp: { $gte: sparkStart, $lt: sparkEnd } };
  const sparkRows = await Event.aggregate([
    { $match: sparkMatch },
    {
      $group: {
        _id: {
          event: '$event',
          day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const sparkMap = new Map();
  for (const row of sparkRows) {
    if (!sparkMap.has(row._id.event)) sparkMap.set(row._id.event, new Map());
    sparkMap.get(row._id.event).set(row._id.day, row.count);
  }

  function sparkFor(eventName) {
    const byDay = sparkMap.get(eventName) || new Map();
    const points = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(sparkEnd.getTime() - i * 24 * 60 * 60 * 1000);
      points.push(byDay.get(date.toISOString().slice(0, 10)) || 0);
    }
    return points;
  }

  return definitions.map((def) => {
    const metric = metrics.get(def.name);
    return {
      id: def.name,
      name: def.name,
      description: def.description,
      category: def.category,
      platform: platform === 'combined' ? 'All' : platform,
      volume: metric?.volume || 0,
      lastSeen: metric?.lastSeen || null,
      status: def.status,
      spark: sparkFor(def.name),
    };
  });
}

async function toggleEventStatus(projectId, name) {
  const def = await EventDefinition.findOne({ projectId, name });
  if (!def) return null;
  def.status = def.status === 'Active' ? 'Inactive' : 'Active';
  await def.save();
  return def;
}

async function addEventDefinition(projectId, { name, description, category }) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) throw new Error('name is required');
  const existing = await EventDefinition.findOne({ projectId, name: normalizedName });
  if (existing) throw new Error('An event with this name already exists');
  return EventDefinition.create({
    projectId,
    name: normalizedName,
    description: description || '',
    category: category || 'other',
    status: 'Active',
  });
}

module.exports = { getEventCatalog, toggleEventStatus, addEventDefinition, ensureCatalogSeeded };
