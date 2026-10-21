const Event = require('../../models/Event');
const OpportunityStatus = require('../../models/OpportunityStatus');
const {
  resolveDateRange,
  applyPlatformDeviceFilter,
  getPersonaUserIds,
  applyPersonaFilter,
} = require('../filterHelpers');

const EVENT_SET = ['product_view', 'add_to_cart', 'view_cart', 'checkout_start', 'shipping_details', 'purchase', 'remove_from_cart'];
const VALID_STATUSES = new Set(['new', 'investigating', 'planned', 'in_progress', 'resolved', 'dismissed']);
const safeNumber = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const pct = (n, d) => d ? Math.round((n / d) * 1000) / 10 : 0;
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toSlug = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'unknown';

function extractProducts(event) {
  const p = event.properties || {};
  const candidates = Array.isArray(p.products) ? p.products : Array.isArray(p.items) ? p.items : null;
  if (candidates?.length) return candidates.map((item) => ({
    id: item.productId || item.product_id || item.item_id || item.id || item.sku || item.title || item.name,
    name: item.productName || item.product_name || item.title || item.name || item.product?.name || item.product?.title,
    price: safeNumber(item.price || item.unitPrice || item.unit_price || item.product?.price),
  })).filter((x) => x.id || x.name);
  const product = p.product && typeof p.product === 'object' ? p.product : {};
  const id = p.productId || p.product_id || p.item_id || p.sku || p.id || product.id || product.productId || product.sku;
  const name = p.productName || p.product_name || p.item_name || p.title || p.name || product.name || product.title;
  if (!id && !name) return [];
  return [{ id: id || name, name: name || String(id), price: safeNumber(p.price || p.unitPrice || product.price) }];
}

function scoreOpportunity({ impact, confidence, effort }) {
  // Transparent weighted score: 40% impact, 35% confidence, 25% ease (inverse effort).
  const ease = ((6 - Math.max(1, Math.min(5, effort))) / 5) * 100;
  return Math.round((impact * 0.4 + confidence * 0.35 + ease * 0.25) * 10) / 10;
}

function buildOpportunity({ key, type, title, summary, evidence, impactLow, impactBase, impactHigh, confidence, effort, affectedSessions, product, recommendation, assumptions = [] }) {
  const impactScore = Math.min(100, Math.round(Math.log10(Math.max(1, impactBase) + 1) * 24));
  return {
    key, type, title, summary, evidence, product: product || null,
    potential: { low: Math.round(impactLow), base: Math.round(impactBase), high: Math.round(impactHigh), currency: 'INR', basis: 'gross revenue scenario' },
    confidence, effort, impactScore, priorityScore: scoreOpportunity({ impact: impactScore, confidence, effort }),
    affectedSessions: affectedSessions || 0, recommendation, assumptions,
    status: 'new', statusNote: '',
  };
}

async function buildRadar({ projectId, period = '30d', customRange, platform = 'combined', device, personas = [] }) {
  const { start, end } = resolveDateRange(period, customRange);
  const match = { projectId, timestamp: { $gte: start, $lt: end }, event: { $in: EVENT_SET } };
  applyPlatformDeviceFilter(match, platform, device);
  const personaFilter = await getPersonaUserIds(projectId, personas, start, end);
  applyPersonaFilter(match, personaFilter);

  // Bound the amount of raw event data processed in memory for busy projects.
  const events = await Event.find(match)
    .select('event sessionId userId timestamp path url properties deviceInfo trafficSource')
    .sort({ timestamp: -1 }).limit(50000).lean();

  const sessions = new Map();
  const products = new Map();
  const revenueEvents = [];
  const allAovs = [];
  const sessionDevice = new Map();
  const ensureSession = (id) => {
    if (!sessions.has(id)) sessions.set(id, { stages: new Set(), products: new Map(), userId: null, device: 'Unknown', total: 0, lastPath: null, events: [] });
    return sessions.get(id);
  };
  for (const e of events) {
    if (!e.sessionId) continue;
    const s = ensureSession(e.sessionId);
    s.stages.add(e.event); s.userId = e.userId || s.userId;
    s.device = e.deviceInfo?.deviceType || s.device;
    s.lastPath = e.path || e.url || s.lastPath;
    s.events.push(e);
    if (e.event === 'purchase') {
      const total = safeNumber(e.properties?.total ?? e.properties?.revenue ?? e.properties?.value);
      if (total > 0) { revenueEvents.push(total); allAovs.push(total); s.total += total; }
    }
    for (const item of extractProducts(e)) {
      const id = String(item.id || item.name);
      const key = toSlug(id);
      if (!products.has(key)) products.set(key, { key, id, name: String(item.name || id), views: new Set(), carts: new Set(), purchases: new Set(), viewEvents: 0, cartEvents: 0, revenue: 0, price: item.price || 0, sessions: new Set() });
      const p = products.get(key); p.name = item.name || p.name; p.price = p.price || item.price || 0; p.sessions.add(e.sessionId);
      if (e.event === 'product_view') { p.views.add(e.sessionId); p.viewEvents += 1; }
      if (e.event === 'add_to_cart') { p.carts.add(e.sessionId); p.cartEvents += 1; }
      if (e.event === 'purchase') { p.purchases.add(e.sessionId); p.revenue += safeNumber(e.properties?.total ?? e.properties?.revenue ?? e.properties?.value); }
      s.products.set(key, p);
    }
  }

  // Historical customer value is calculated separately from the selected window so a
  // valuable returning customer can still be recognized when their current session abandons.
  const knownUserIds = [...new Set([...sessions.values()].map((s) => s.userId).filter(Boolean))];
  const historicalValueRows = knownUserIds.length ? await Event.aggregate([
    { $match: { projectId, event: 'purchase', userId: { $in: knownUserIds } } },
    { $group: { _id: '$userId', orders: { $sum: 1 }, revenue: { $sum: { $convert: { input: { $ifNull: ['$properties.total', { $ifNull: ['$properties.revenue', '$properties.value'] }] }, to: 'double', onError: 0, onNull: 0 } } } } },
  ]) : [];
  const lifetimeValue = new Map(historicalValueRows.map((row) => [row._id, row]));
  const highValueUsers = new Set(historicalValueRows.filter((row) => row.orders >= 2 || row.revenue >= 5000).map((row) => row._id));
  const sessionCount = (eventName) => [...sessions.values()].filter((s) => s.stages.has(eventName)).length;
  const productViewSessions = sessionCount('product_view');
  const cartSessions = sessionCount('add_to_cart');
  const viewCartSessions = sessionCount('view_cart');
  const checkoutSessions = sessionCount('checkout_start');
  const purchaseSessions = sessionCount('purchase');
  const totalRevenue = revenueEvents.reduce((sum, n) => sum + n, 0);
  const aov = allAovs.length ? totalRevenue / allAovs.length : 0;
  const opportunities = [];

  for (const p of products.values()) {
    const views = p.views.size, carts = p.carts.size, purchases = p.purchases.size;
    if (views >= 20 && pct(carts, views) < 8) {
      const targetRate = Math.max(pct(carts, views) + 3, Math.min(12, pct(carts, views) * 1.6));
      const incrementalCarts = Math.max(0, views * (targetRate - pct(carts, views)) / 100);
      const purchaseRate = cartSessions ? purchaseSessions / cartSessions : 0;
      const base = incrementalCarts * purchaseRate * aov;
      opportunities.push(buildOpportunity({
        key: `product-interest-${p.key}`, type: 'product_interest', title: `${p.name}: product interest isn't becoming cart activity`,
        summary: 'Product pages receive attention, but relatively few viewed sessions add the item to cart.',
        evidence: [{ label: 'Product-view sessions', value: views }, { label: 'Add-to-cart sessions', value: carts }, { label: 'Add-to-cart rate', value: `${pct(carts, views)}%` }],
        impactLow: base * 0.5, impactBase: base, impactHigh: base * 1.8, confidence: views >= 100 ? 78 : 58, effort: 2, affectedSessions: views - carts, product: { id: p.id, name: p.name },
        recommendation: 'Inspect the product detail page, price/value presentation, availability, imagery and primary CTA. Validate with session replay before choosing a fix.',
        assumptions: [`Target add-to-cart rate: ${round(targetRate)}% scenario, not a forecast`, `Uses observed overall cart-to-purchase rate (${round(purchaseRate * 100)}%) and observed AOV (₹${Math.round(aov).toLocaleString('en-IN')})`, 'Product identity is inferred from event properties; unlabelled events are excluded from product attribution'],
      }));
    }
  }

  if (cartSessions >= 15 && purchaseSessions / Math.max(1, cartSessions) < 0.35) {
    const drop = Math.max(0, cartSessions - purchaseSessions);
    const improvement = Math.min(0.1, Math.max(0.03, (1 - purchaseSessions / cartSessions) * 0.15));
    const base = drop * improvement * aov;
    opportunities.push(buildOpportunity({
      key: 'checkout-completion', type: 'checkout_leakage', title: 'Cart-to-purchase completion is below the opportunity threshold',
      summary: 'Many sessions add an item to cart but do not reach a recorded purchase in the selected window.',
      evidence: [{ label: 'Add-to-cart sessions', value: cartSessions }, { label: 'Purchase sessions', value: purchaseSessions }, { label: 'Cart-to-purchase rate', value: `${pct(purchaseSessions, cartSessions)}%` }, { label: 'Checkout starts', value: checkoutSessions }],
      impactLow: base * 0.5, impactBase: base, impactHigh: base * 1.7, confidence: cartSessions >= 100 ? 80 : 60, effort: 3, affectedSessions: drop,
      recommendation: 'Compare cart, checkout and purchase journeys by device. Inspect shipping surprises, form validation, payment errors and tracking gaps before attributing the drop-off to UX.',
      assumptions: [`Scenario assumes recovering ${round(improvement * 100)}% of the cart-to-purchase gap`, `Uses observed AOV (₹${Math.round(aov).toLocaleString('en-IN')})`, 'Sessions are counted once per stage; events in different reporting windows may not represent a single ordered funnel'],
    }));
  }

  for (const p of products.values()) {
    const views = p.views.size, carts = p.carts.size;
    if (views >= 20 && pct(carts, views) >= 10 && views <= Math.max(200, productViewSessions * 0.08)) {
      const extraViews = Math.max(0, Math.min(productViewSessions * 0.05, views * 0.5));
      const base = extraViews * (carts / Math.max(1, views)) * (purchaseSessions / Math.max(1, cartSessions)) * aov;
      opportunities.push(buildOpportunity({
        key: `low-traffic-winner-${p.key}`, type: 'low_traffic_winner', title: `${p.name}: strong conversion with limited exposure`,
        summary: 'This product converts above the radar threshold but has relatively low qualified traffic.',
        evidence: [{ label: 'Product-view sessions', value: views }, { label: 'Add-to-cart rate', value: `${pct(carts, views)}%` }, { label: 'Traffic share', value: `${pct(views, Math.max(1, productViewSessions))}%` }],
        impactLow: base * 0.5, impactBase: base, impactHigh: base * 1.8, confidence: views >= 100 ? 72 : 52, effort: 2, affectedSessions: views, product: { id: p.id, name: p.name },
        recommendation: 'Test better category placement, internal search ranking, related-product exposure or merchandising. Increase qualified exposure gradually and monitor conversion quality.',
        assumptions: ['Traffic uplift is a scenario, not a promise', 'Uses current product add-to-cart rate, overall cart-to-purchase rate and observed AOV'],
      }));
    }
  }

  // Repeated friction proxy: a session repeats checkout-related events or revisits the same path.
  const frictionSessions = [];
  for (const [id, s] of sessions) {
    const checkoutCount = s.events.filter((e) => ['checkout_start', 'shipping_details'].includes(e.event)).length;
    const paths = s.events.map((e) => e.path).filter(Boolean);
    const repeatedPath = paths.some((path, i) => paths.indexOf(path) !== i);
    if ((checkoutCount >= 2 || repeatedPath) && s.stages.has('checkout_start') && !s.stages.has('purchase')) frictionSessions.push({ id, ...s });
  }
  const highValueFriction = frictionSessions.filter((s) => s.userId && highValueUsers.has(s.userId));
  if (frictionSessions.length >= 5) {
    const base = frictionSessions.length * (aov || 0) * 0.05;
    opportunities.push(buildOpportunity({
      key: 'repeated-checkout-friction', type: 'customer_friction', title: 'Repeated checkout activity appears in abandoned sessions',
      summary: 'Some sessions revisit pages or repeat checkout-related events before leaving without a recorded purchase. This is a friction signal, not proof of a UX defect.',
      evidence: [{ label: 'Sessions with repeat activity', value: frictionSessions.length }, { label: 'High-value customer sessions', value: highValueFriction.length }, { label: 'Sessions without purchase', value: frictionSessions.length }],
      impactLow: base * 0.4, impactBase: base, impactHigh: base * 1.5, confidence: frictionSessions.length >= 30 ? 65 : 45, effort: 3, affectedSessions: frictionSessions.length,
      recommendation: 'Open representative session replays where available and segment by device/persona. Confirm the event sequence and exclude legitimate revisits before planning a change.',
      assumptions: ['Repeat activity is a heuristic based on event sequence/path repetition', 'Potential upside uses 5% of affected sessions and observed AOV; validate before acting'],
    }));
  }

  const keys = opportunities.map((o) => o.key);
  const saved = keys.length ? await OpportunityStatus.find({ projectId, opportunityKey: { $in: keys } }).lean() : [];
  const savedMap = new Map(saved.map((s) => [s.opportunityKey, s]));
  const enriched = opportunities.map((o) => {
    const status = savedMap.get(o.key);
    return { ...o, status: status?.status || 'new', statusNote: status?.note || '', updatedAt: status?.updatedAt || null };
  }).sort((a, b) => b.priorityScore - a.priorityScore);

  // Conservative portfolio roll-up: product-level estimates can overlap with
  // the broad checkout/friction estimate, so do not add those buckets together.
  // Sum distinct product-level opportunities, then compare that subtotal with
  // the largest site-wide checkout/friction scenario and retain the larger bucket.
  const openOpportunities = enriched.filter((o) => !['dismissed', 'resolved'].includes(o.status));
  const productBucket = openOpportunities.filter((o) => ['product_interest', 'low_traffic_winner'].includes(o.type)).reduce((acc, o) => ({ low: acc.low + o.potential.low, base: acc.base + o.potential.base, high: acc.high + o.potential.high }), { low: 0, base: 0, high: 0 });
  const journeyBucket = openOpportunities.filter((o) => ['checkout_leakage', 'customer_friction'].includes(o.type)).reduce((max, o) => ({ low: Math.max(max.low, o.potential.low), base: Math.max(max.base, o.potential.base), high: Math.max(max.high, o.potential.high) }), { low: 0, base: 0, high: 0 });
  const totalPotential = { low: Math.round(Math.max(productBucket.low, journeyBucket.low)), base: Math.round(Math.max(productBucket.base, journeyBucket.base)), high: Math.round(Math.max(productBucket.high, journeyBucket.high)) };
  return {
    generatedAt: new Date().toISOString(), period, range: { from: start.toISOString(), to: end.toISOString() },
    summary: { opportunities: enriched.filter((o) => !['dismissed', 'resolved'].includes(o.status)).length, highPriority: enriched.filter((o) => o.priorityScore >= 65 && !['dismissed', 'resolved'].includes(o.status)).length, totalPotential, revenueObserved: Math.round(totalRevenue), averageOrderValue: Math.round(aov), sessions: sessions.size, productViewSessions, cartSessions, viewCartSessions, checkoutSessions, purchaseSessions, dataTruncated: events.length >= 50000 },
    opportunities: enriched,
  };
}

async function updateOpportunityStatus({ projectId, opportunityKey, status, note = '' }) {
  if (!VALID_STATUSES.has(status)) throw Object.assign(new Error('Invalid opportunity status'), { status: 400 });
  if (!opportunityKey || typeof opportunityKey !== 'string' || opportunityKey.length > 180) throw Object.assign(new Error('Invalid opportunity key'), { status: 400 });
  const safeNote = String(note || '').slice(0, 1000);
  return OpportunityStatus.findOneAndUpdate(
    { projectId, opportunityKey },
    { $set: { status, note: safeNote, updatedAt: new Date() } },
    { upsert: true, new: true, runValidators: true },
  ).lean();
}

module.exports = { buildRadar, updateOpportunityStatus };
