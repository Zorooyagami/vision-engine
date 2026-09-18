// services/eventCatalog.js
const Event = require('../models/Event');
const EventDefinition = require('../models/EventDefinition');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
  applyPersonaFilter,
} = require('./filterHelpers');
// Category inferred from name — no hardcoded per-event list to maintain
function inferCategory(name) {
  if (['view_item_list', 'product_view', 'search_performed', 'filter_applied', 'sort_changed', 'select_item', 'page_view', 'heatmap_click', 'heatmap_move'].includes(name)) return 'browsing';
  if (['add_to_cart', 'remove_from_cart', 'view_cart'].includes(name)) return 'cart';
  if (['checkout_start', 'shipping_details', 'purchase'].includes(name)) return 'checkout';
  return 'other';
}

// Auto-registers any event name found in raw data that doesn't have a
// definition row yet — no manual catalog to keep in sync.
async function ensureCatalogSeeded() {
  const distinctNames = await Event.distinct('event');
  const existing = await EventDefinition.find({}, { name: 1 }).lean();
  const existingNames = new Set(existing.map((d) => d.name));
  const missing = distinctNames.filter((n) => !existingNames.has(n));

  if (missing.length) {
    await EventDefinition.insertMany(
      missing.map((name) => ({ name, category: inferCategory(name), description: '', status: 'Active' }))
    );
  }
}

async function getSparkline(eventName, baseMatch) {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

  const rows = await Event.aggregate([
    { $match: { ...baseMatch, event: eventName, timestamp: { $gte: start, $lt: end } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const byDay = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const points = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    points.push(byDay[key] || 0);
  }
  return points;
}

async function getEventCatalog({ period = '30d', customRange, personas = [], platform = 'combined', device }) {
  await ensureCatalogSeeded();

  const { start, end } = resolveDateRange(period, customRange);
  const windowMatch = { timestamp: { $gte: start, $lt: end } };
  applyPlatformDeviceFilter(windowMatch, platform, device);

  const personaFilter = await getPersonaUserIds(personas, start, end);
  applyPersonaFilter(windowMatch, personaFilter);

  const definitions = await EventDefinition.find({}).lean();

  const events = await Promise.all(
    definitions.map(async (def) => {
      const [volume, lastEvent, spark] = await Promise.all([
        Event.countDocuments({ ...windowMatch, event: def.name }),
        Event.findOne({ ...windowMatch, event: def.name }).sort({ timestamp: -1 }).select('timestamp').lean(),
        getSparkline(def.name, windowMatch),
      ]);

      return {
        id: def.name,
        name: def.name,
        description: def.description,
        category: def.category,
        platform: platform === 'combined' ? 'All' : platform,
        volume,
        lastSeen: lastEvent ? lastEvent.timestamp : null,
        status: def.status,
        spark,
      };
    })
  );

  return events;
}

async function toggleEventStatus(name) {
  const def = await EventDefinition.findOne({ name });
  if (!def) return null;
  def.status = def.status === 'Active' ? 'Inactive' : 'Active';
  await def.save();
  return def;
}

async function addEventDefinition({ name, description, category }) {
  const existing = await EventDefinition.findOne({ name });
  if (existing) throw new Error('An event with this name already exists');
  return EventDefinition.create({ name, description: description || '', category: category || 'other', status: 'Active' });
}

module.exports = { getEventCatalog, toggleEventStatus, addEventDefinition };