/*
 * Revenue Opportunity Radar: observations only.
 * No estimated revenue, conversion uplift, simulated confidence or inferred sales.
 * The SDK emits client-side events, which are not proof of settled payments.
 */
const Event = require('../../models/Event');
const BehaviorEvent = require('../../models/BehaviorEvent');
const OpportunityStatus = require('../../models/OpportunityStatus');
const { resolveDateRange, applyPlatformDeviceFilter, getPersonaUserIds, applyPersonaFilter } = require('../filterHelpers');

const EVENTS = ['product_view', 'add_to_cart', 'view_cart', 'checkout_start', 'shipping_details', 'purchase'];
const STATUSES = new Set(['new', 'investigating', 'planned', 'in_progress', 'resolved', 'dismissed']);
const LIMIT = 50000;
const ratio = (num, denom) => denom ? Math.round(num / denom * 1000) / 10 : 0;
const slug = (value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const err = (message, status) => Object.assign(new Error(message), { status });
const text = (value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

function extractProduct(e) {
  const p = e.properties || {};
  const embedded = p.product && typeof p.product === 'object' ? p.product : {};
  // `title` is intentionally excluded: storefront events use it for document.title.
  const id = text(p.productId ?? p.product_id ?? p.item_id ?? p.sku ?? embedded.productId ?? embedded.id);
  if (!id) return null; // Don't guess a product ID from page titles or categories.
  // Never substitute the website/page title as a product name. If the event's
  // `name` equals the document title, treat it as missing product metadata.
  const explicitName = text(p.productName || p.product_name || embedded.name);
  const tentativeName = text(p.name);
  const pageTitle = text(p.title);
  const candidateName = explicitName || tentativeName;
  const name = candidateName && (!pageTitle || candidateName !== pageTitle) ? candidateName : `Product ID: ${id}`;
  return { id, name, key: slug(id) };
}

function observation({ key, type, title, summary, evidence, affectedSessions, recommendation, note, priorityScore, strength, detectionRule, productId }) {
  return { key, type, title, summary, evidence, affectedSessions, recommendation, note, detectionRule, productId,
    priorityScore, strength, status: 'new', statusNote: '', evidenceLevel: 'actionable' };
}

function orderedStageSessions(sessions, from, to) {
  let count = 0;
  for (const session of sessions.values()) {
    const start = session.first.get(from);
    const end = session.first.get(to);
    if (start !== undefined && end !== undefined && end >= start) count++;
  }
  return count;
}

async function buildRadar({ projectId, period = '30d', customRange, platform = 'combined', device, personas = [] }) {
  const { start, end } = resolveDateRange(period, customRange);
  const match = { projectId, timestamp: { $gte: start, $lt: end }, event: { $in: EVENTS } };
  applyPlatformDeviceFilter(match, platform, device);
  applyPersonaFilter(match, await getPersonaUserIds(projectId, personas, start, end));
  // Limit+1 is required to distinguish a complete set from a truncated sample.
  const events = await Event.find(match).select('event sessionId userId timestamp path properties deviceInfo')
    .sort({ timestamp: 1, _id: 1 }).limit(LIMIT + 1).lean();
  if (events.length > LIMIT) throw err('More than 50,000 matching events. Select a shorter date range for accurate, complete results.', 413);

  const sessions = new Map();
  const products = new Map();
  const orderIds = new Set();
  const currencyTotals = new Map();
  const quality = { eventCount: events.length, missingSessionIds: 0, missingProductIds: 0,
    missingOrderIds: 0, duplicatePurchaseEvents: 0,
    missingCurrencyOrAmount: 0, trackedOrders: 0 };
  const ensure = (id) => {
    if (!sessions.has(id)) sessions.set(id, { first: new Map(), products: new Map(), purchased: false });
    return sessions.get(id);
  };

  for (const e of events) {
    if (!e.sessionId) { quality.missingSessionIds++; continue; }
    const s = ensure(e.sessionId);
    const when = +new Date(e.timestamp);
    if (!Number.isFinite(when)) continue;
    if (!s.first.has(e.event)) s.first.set(e.event, when);
    if (e.event === 'purchase') s.purchased = true;

    if (e.event === 'product_view' || e.event === 'add_to_cart') {
      const product = extractProduct(e);
      if (!product) { quality.missingProductIds++; continue; }
      if (!products.has(product.key)) products.set(product.key, { ...product, views: new Set(), carts: new Set(), qualifiedCarts: new Set() });
      const p = products.get(product.key);
      if (p.name.startsWith('Product ID: ') && !product.name.startsWith('Product ID: ')) p.name = product.name;
      if (!s.products.has(product.key)) s.products.set(product.key, {});
      const ps = s.products.get(product.key);
      if (e.event === 'product_view') { p.views.add(e.sessionId); ps.view = Math.min(ps.view ?? when, when); }
      if (e.event === 'add_to_cart') {
        p.carts.add(e.sessionId);
        if (ps.view !== undefined && when >= ps.view) p.qualifiedCarts.add(e.sessionId);
      }
    }
    if (e.event !== 'purchase') continue;
    const properties = e.properties || {};
    const orderId = text(properties.orderId || properties.order_id);
    if (!orderId) { quality.missingOrderIds++; continue; }
    if (orderIds.has(orderId)) { quality.duplicatePurchaseEvents++; continue; }
    orderIds.add(orderId);
    const currency = text(properties.currency).toUpperCase();
    const raw = properties.total ?? properties.revenue ?? properties.value;
    const amount = raw === null || raw === undefined || String(raw).trim() === '' ? NaN : Number(raw);
    if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(amount) || amount < 0) {
      quality.missingCurrencyOrAmount++;
      continue;
    }
    currencyTotals.set(currency, (currencyTotals.get(currency) || 0) + amount);
    quality.trackedOrders++;
  }

  const countStage = (name) => [...sessions.values()].filter((s) => s.first.has(name)).length;
  const viewed = countStage('product_view');
  const cart = countStage('add_to_cart');
  const viewCart = countStage('view_cart');
  const checkout = countStage('checkout_start');
  const purchased = countStage('purchase');
  const opportunities = [];

  // Product observations are session based, deduped, and require the view before the cart.
  for (const p of products.values()) {
    const n = p.views.size;
    if (n < 20) continue;
    const qualified = p.qualifiedCarts.size;
    const rate = ratio(qualified, n);
    const strength = n >= 100 ? 'Larger sample' : 'Limited sample';
    if (rate < 8) {
      opportunities.push(observation({ key: `product-interest-${p.key}`, type: 'product_interest',
        title: `${p.name}: ${rate}% viewed-to-cart rate across ${n} sessions`,
        summary: `${qualified} of ${n} sessions that viewed this product later added it to cart (${rate}%). This is below the 8% screening threshold; it does not establish why shoppers did not add it.`,
        evidence: [{ label: 'Product-view sessions', value: n }, { label: 'Sessions with later add-to-cart', value: qualified }, { label: 'Observed add-to-cart rate', value: `${rate}%` }],
        affectedSessions: n - qualified, strength, productId: p.id,
        detectionRule: `At least 20 distinct product-view sessions AND later add-to-cart rate below 8%. Observed: ${n} sessions and ${rate}%.`,
        priorityScore: Math.round(Math.min(100, n / 2) * 0.6 + (100 - rate) * 0.4),
        recommendation: 'Review the product detail page, availability and add-to-cart flow. Compare with similar products and examine replays before making changes.',
        note: 'Threshold: at least 20 product-view sessions and less than 8% later adding this item. Events may be missed when tracking is disabled.' }));
    }
  }

  // This is not a strict abandoned-cart metric: event-stage totals may overlap, and purchases
  // can occur in a different visit. Only flag sessions that recorded cart before window end.
  const cartNoPurchase = [...sessions.values()].filter((s) => s.first.has('add_to_cart') && !s.purchased).length;
  if (cart >= 15 && cartNoPurchase >= 5) {
    opportunities.push(observation({ key: 'cart-without-purchase', type: 'checkout_leakage',
      title: 'Sessions added to cart without a recorded purchase',
      summary: `${cartNoPurchase} of ${cart} add-to-cart sessions had no purchase event in the selected window. They may have purchased later or on another device.`,
      evidence: [{ label: 'Sessions adding to cart', value: cart }, { label: 'Without purchase event', value: cartNoPurchase }, { label: 'Share without recorded purchase', value: `${ratio(cartNoPurchase, cart)}%` }, { label: 'Checkout-start sessions', value: checkout }],
      affectedSessions: cartNoPurchase, strength: cart >= 100 ? 'Larger sample' : 'Limited sample',
      detectionRule: `At least 15 add-to-cart sessions AND at least 5 with no recorded purchase. Observed: ${cart} and ${cartNoPurchase}.`,
      priorityScore: Math.round(Math.min(100, cart / 2) * 0.6 + ratio(cartNoPurchase, cart) * 0.4),
      recommendation: 'Inspect the cart-to-payment funnel, payment errors, and tracking completeness. Validate the sessions before calling them abandoned carts.',
      note: 'Not verified cart abandonment. Cross-session transactions, consent settings, and missing purchase events affect this count.' }));
  }

  // Only flag low-exposure products relative to other products with a usable sample.
  const eligible = [...products.values()].filter((p) => p.views.size >= 20);
  const projectRate = ratio(eligible.reduce((sum, p) => sum + p.qualifiedCarts.size, 0), eligible.reduce((sum, p) => sum + p.views.size, 0));
  const sortedViews = eligible.map((p) => p.views.size).sort((a, b) => a - b);
  const medianViews = sortedViews.length ? sortedViews[Math.floor((sortedViews.length - 1) / 2)] : 0;
  if (eligible.length >= 3 && projectRate > 0) for (const p of eligible) {
    const n = p.views.size;
    const rate = ratio(p.qualifiedCarts.size, n);
    if (n <= medianViews && rate >= projectRate * 1.5 && p.qualifiedCarts.size >= 5) {
      opportunities.push(observation({ key: `low-traffic-winner-${p.key}`, type: 'low_traffic_winner',
        title: `${p.name}: ${rate}% viewed-to-cart rate versus ${projectRate}% overall`,
        summary: `${p.qualifiedCarts.size} of ${n} viewing sessions added this product to cart. The rate is ${rate}%, versus ${projectRate}% across tracked products with 20+ viewing sessions. The product had ${n} viewing sessions versus a median of ${medianViews}.`,
        evidence: [{ label: 'Product-view sessions', value: n }, { label: 'Later add-to-cart sessions', value: p.qualifiedCarts.size }, { label: 'Product add-to-cart rate', value: `${rate}%` }, { label: 'Project-wide product rate', value: `${projectRate}%` }],
        affectedSessions: n, strength: n >= 100 ? 'Larger sample' : 'Limited sample', productId: p.id,
        detectionRule: `At least 3 eligible products, product views at/below median (${medianViews}), at least 5 later add-to-cart sessions, and rate at least 1.5× the eligible-product rate (${projectRate}%).`,
        priorityScore: Math.round(Math.min(100, n / 2) * 0.5 + Math.min(100, rate - projectRate) * 0.5),
        recommendation: 'Investigate whether the product deserves more visibility. Run a small merchandising experiment; compare add-to-cart and completed purchase outcomes.',
        note: 'This identifies observed cart interest, not proven sales conversion or revenue upside.' }));
    }
  }

  // Explicit friction events, rather than treating a repeated page view as a defect.
  const frictionMatch = { projectId, timestamp: { $gte: start, $lt: end }, kind: { $in: ['repeated_click', 'validation_failure', 'javascript_error'] } };
  // Behavior events store device separately; avoid claiming persona/device parity when filters cannot be applied.
  if (device && String(device).toLowerCase() !== 'all') {
    const deviceLabel = String(device).charAt(0).toUpperCase() + String(device).slice(1).toLowerCase();
    frictionMatch.device = deviceLabel;
  } else if (platform === 'web') frictionMatch.device = 'Desktop';
  else if (platform === 'app') frictionMatch.device = { $in: ['Mobile', 'Tablet'] };
  // Do not combine behavior events with persona-scoped results unless exact session scope can be checked.
  if (!personas.length) {
    const problems = await BehaviorEvent.find(frictionMatch).select('sessionId kind path environment').limit(LIMIT + 1).lean();
    if (problems.length > LIMIT) throw err('More than 50,000 matching friction events. Select a shorter date range.', 413);
    const checkoutIssues = new Map();
    for (const b of problems) {
      if (!b.sessionId || !/\/(cart|checkout|payment)(\/|$)/i.test(b.path || '')) continue;
      if (!checkoutIssues.has(b.sessionId)) checkoutIssues.set(b.sessionId, new Set());
      checkoutIssues.get(b.sessionId).add(b.kind);
    }
    if (checkoutIssues.size >= 5) {
      const types = [...new Set([...checkoutIssues.values()].flatMap((s) => [...s]))];
      opportunities.push(observation({ key: 'checkout-friction-events', type: 'customer_friction',
        title: 'Explicit interaction errors observed around checkout',
        summary: `${checkoutIssues.size} sessions had a repeated-click, validation, or JavaScript error event on a cart/checkout/payment URL.`,
        evidence: [{ label: 'Sessions with error signals', value: checkoutIssues.size }, { label: 'Observed error types', value: types.join(', ') }],
        affectedSessions: checkoutIssues.size, strength: checkoutIssues.size >= 30 ? 'Larger sample' : 'Limited sample',
        detectionRule: `At least 5 distinct sessions with explicit friction events on cart, checkout or payment routes. Observed: ${checkoutIssues.size}.`,
        priorityScore: Math.round(Math.min(100, checkoutIssues.size * 2)),
        recommendation: 'Review error logs and matching session replays. Confirm which UI element failed and whether it blocked purchases.',
        note: 'Only explicit SDK friction events on matching URL paths are counted. These are not confirmed bugs.' }));
    }
  }

  // Exploratory observations are NOT asserted problems. They make smaller or
  // healthy-looking real datasets useful without relaxing actionable thresholds.
  // Every observation must be backed by recorded events; never synthesize rows.
  const existing = new Set(opportunities.map((o) => o.key));
  const explore = (details) => {
    if (existing.has(details.key)) return;
    const row = observation(details);
    row.evidenceLevel = 'exploratory';
    row.priorityScore = 0; // Don't rank tentative findings above threshold-backed alerts.
    opportunities.push(row);
    existing.add(row.key);
  };

  // Show the most-observed real products, even if they lack enough visits to
  // conclude they have a problem. Cap this to avoid overwhelming the page.
  const productSnapshots = [...products.values()].filter((p) => p.views.size > 0)
    .sort((a, b) => b.views.size - a.views.size || a.key.localeCompare(b.key))
    .slice(0, 8);
  for (const p of productSnapshots) {
    const n = p.views.size;
    const added = p.qualifiedCarts.size;
    const rate = ratio(added, n);
    // If a firm low-engagement alert already exists, avoid repeating the same
    // product as an exploratory engagement card.
    if (existing.has(`product-interest-${p.key}`) || existing.has(`low-traffic-winner-${p.key}`)) continue;
    explore({ key: `product-snapshot-${p.key}`, type: 'product_activity',
      title: `${p.name}: ${n} product-view session${n === 1 ? '' : 's'}`,
      summary: `${added} of ${n} sessions that viewed this tracked product subsequently added the same product to cart (${rate}%). ${n < 20 ? 'There are fewer than 20 viewing sessions, so this is descriptive only.' : 'This is an activity snapshot; no low-engagement alert threshold was crossed.'}`,
      evidence: [{ label: 'Product-view sessions', value: n }, { label: 'Later same-product cart sessions', value: added }, { label: 'Observed viewed-to-cart rate', value: `${rate}%` }],
      affectedSessions: n, strength: n < 20 ? 'Small sample' : 'Observation', productId: p.id,
      detectionRule: `Recorded at least one product-view session with a valid product ID. Observed: ${n} viewing sessions. This is not a defect or sales-conversion claim.`,
      recommendation: 'Review this product alongside the larger-sample products. Keep collecting events before making conversion claims.',
      note: 'Only tracked sessions are counted. Sessions without product IDs cannot be attributed to products.' });
  }

  if (cart > 0 && !existing.has('cart-without-purchase')) {
    explore({ key: 'cart-journey-snapshot', type: 'journey_activity',
      title: `${cart} sessions added to cart; ${cartNoPurchase} had no recorded purchase`,
      summary: `${ratio(cartNoPurchase, cart)}% of add-to-cart sessions in this window did not contain a purchase event. This does not prove cart abandonment.`,
      evidence: [{ label: 'Add-to-cart sessions', value: cart }, { label: 'Without purchase event', value: cartNoPurchase }, { label: 'Checkout-start sessions', value: checkout }],
      affectedSessions: cart, strength: 'Observation',
      detectionRule: `At least one real add-to-cart session was recorded. The action threshold (15 cart sessions and 5 without a purchase) was not met; observed ${cart} and ${cartNoPurchase}.`,
      recommendation: 'Validate tracking of purchases and compare cart and checkout sessions. Investigate only if a sustained pattern emerges.',
      note: 'Purchase may happen later, elsewhere, or without analytics consent.' });
  }
  if (checkout > 0) {
    const completed = orderedStageSessions(sessions, 'checkout_start', 'purchase');
    explore({ key: 'checkout-journey-snapshot', type: 'journey_activity',
      title: `${checkout} checkout-start sessions; ${completed} later recorded a purchase`,
      summary: `In ${completed} sessions, a recorded purchase followed checkout start within the selected period (${ratio(completed, checkout)}% of checkout-start sessions). This is not a verified payment-success rate.`,
      evidence: [{ label: 'Checkout-start sessions', value: checkout }, { label: 'Later purchase event in same session', value: completed }, { label: 'Observed same-session rate', value: `${ratio(completed, checkout)}%` }],
      affectedSessions: checkout, strength: 'Observation',
      detectionRule: 'At least one checkout-start session was recorded. Only event order within the same session is checked.',
      recommendation: 'Check payment and order confirmation logs before interpreting this ratio as checkout conversion.',
      note: 'Events can be missed and client-side purchases are not settlement proof.' });
  }
  if (quality.missingProductIds > 0) {
    explore({ key: 'product-metadata-coverage', type: 'data_quality',
      title: `${quality.missingProductIds} product events could not be assigned to a product`,
      summary: `These real product-view or add-to-cart events did not carry a usable product ID. Product-level analysis may therefore be incomplete.`,
      evidence: [{ label: 'Product events missing ID', value: quality.missingProductIds }, { label: 'Matching analytics events examined', value: quality.eventCount }],
      affectedSessions: 0, strength: 'Tracking coverage',
      detectionRule: 'At least one recorded product_view or add_to_cart event lacks productId/product_id/item_id/sku.',
      recommendation: 'Send a stable productId and optional productName with product_view and add_to_cart events.',
      note: 'This is an instrumentation finding, not shopper friction.' });
  }

  const keys = opportunities.map((o) => o.key);
  const stored = keys.length ? await OpportunityStatus.find({ projectId, opportunityKey: { $in: keys } }).lean() : [];
  const storedMap = new Map(stored.map((s) => [s.opportunityKey, s]));
  const annotated = opportunities.map((o) => ({ ...o, status: storedMap.get(o.key)?.status || 'new',
    statusNote: storedMap.get(o.key)?.note || '' })).sort((a, b) => b.priorityScore - a.priorityScore);
  const trackedValues = [...currencyTotals].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));
  return { generatedAt: new Date().toISOString(), period, range: { from: start.toISOString(), to: end.toISOString() },
    summary: { opportunities: annotated.filter((o) => !['resolved', 'dismissed'].includes(o.status)).length,
      actionableSignals: annotated.filter((o) => o.evidenceLevel === 'actionable' && !['resolved', 'dismissed'].includes(o.status)).length,
      exploratoryObservations: annotated.filter((o) => o.evidenceLevel === 'exploratory' && !['resolved', 'dismissed'].includes(o.status)).length,
      sessions: sessions.size, productViewSessions: viewed, cartSessions: cart, viewCartSessions: viewCart,
      checkoutSessions: checkout, purchaseSessions: purchased,
      viewToCartSessions: orderedStageSessions(sessions, 'product_view', 'add_to_cart'),
      cartToCheckoutSessions: orderedStageSessions(sessions, 'add_to_cart', 'checkout_start'),
      checkoutToPurchaseSessions: orderedStageSessions(sessions, 'checkout_start', 'purchase'),
      trackedPurchaseValues: trackedValues, quality }, opportunities: annotated };
}

async function updateOpportunityStatus({ projectId, opportunityKey, status, note = '' }) {
  if (!STATUSES.has(status)) throw err('Invalid opportunity status', 400);
  if (!opportunityKey || typeof opportunityKey !== 'string' || opportunityKey.length > 180) throw err('Invalid opportunity key', 400);
  return OpportunityStatus.findOneAndUpdate({ projectId, opportunityKey },
    { $set: { status, note: String(note || '').slice(0, 1000), updatedAt: new Date() } },
    { upsert: true, new: true, runValidators: true }).lean();
}

module.exports = { buildRadar, updateOpportunityStatus };
