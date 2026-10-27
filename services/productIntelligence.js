const Event = require('../models/Event');
const catalogue = require('../data/products');
const { resolveDateRange, applyPlatformDeviceFilter, getPersonaUserIds, applyPersonaFilter } = require('./filterHelpers');

const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const clean = (value) => (typeof value === 'string' ? value.trim() : '');

async function getProductIntelligence(req, res) {
  try {
    const period = req.query.period || '30d';
    const customRange = req.query.period === 'custom' ? { from: req.query.from, to: req.query.to } : null;
    const { start, end } = resolveDateRange(period, customRange);
    const match = {
      projectId: req.projectId,
      timestamp: { $gte: start, $lt: end },
      event: { $in: ['search_performed', 'search', 'product_view', 'view_item', 'add_to_cart', 'purchase'] },
    };
    applyPlatformDeviceFilter(match, req.query.platform || 'combined', req.query.device);
    const personas = String(req.query.personas || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (personas.length) {
      const personaFilter = await getPersonaUserIds(req.projectId, personas, start, end);
      applyPersonaFilter(match, personaFilter);
    }

    // Keep the projection narrow and cap the defensive fallback for unusually large demo projects.
    const events = await Event.find(match)
      .select({ event: 1, timestamp: 1, userId: 1, sessionId: 1, properties: 1, path: 1, deviceInfo: 1 })
      .sort({ timestamp: -1 })
      .limit(50000)
      .lean();

    const catalogueRows = Array.isArray(catalogue) ? catalogue : (Array.isArray(catalogue.products) ? catalogue.products : []);
    const catalogueById = new Map(catalogueRows.map((p) => [String(p.id ?? p.productId), p]));
    const products = new Map();
    const searches = new Map();
    const totals = { searches: 0, searchers: new Set(), views: 0, viewers: new Set(), cartAdds: 0, cartUsers: new Set(), orders: new Set(), unitsSold: 0, revenue: 0 };

    function ensureProduct(id, details = {}) {
      const key = String(id ?? 'unknown');
      if (!products.has(key)) {
        const catalog = catalogueById.get(key) || {};
        products.set(key, {
          productId: id ?? null,
          name: clean(details.productName || details.name || catalog.name) || (id != null ? `Product ${id}` : 'Unidentified product'),
          brand: clean(details.brand || catalog.brand),
          category: (clean(details.category) && clean(details.category) !== clean(details.name || details.productName)) ? clean(details.category) : clean(catalog.category),
          subCategory: (clean(details.subCategory) && clean(details.subCategory) !== clean(details.name || details.productName)) ? clean(details.subCategory) : clean(catalog.subCategory),
          price: asNumber(details.productPrice ?? details.price ?? catalog.price),
          views: 0, uniqueViewers: new Set(), cartAdds: 0, cartUsers: new Set(), unitsSold: 0, orders: new Set(), revenue: 0,
        });
      } else {
        const row = products.get(key);
        row.name = clean(details.productName || details.name) || row.name;
        row.brand = clean(details.brand) || row.brand;
        if (clean(details.category) && clean(details.category) !== clean(details.name || details.productName)) row.category = clean(details.category);
        if (clean(details.subCategory) && clean(details.subCategory) !== clean(details.name || details.productName)) row.subCategory = clean(details.subCategory);
        if (asNumber(details.productPrice ?? details.price) > 0) row.price = asNumber(details.productPrice ?? details.price);
      }
      return products.get(key);
    }

    for (const event of events) {
      const props = event.properties || {};
      const userKey = event.userId || `guest:${event.sessionId || 'unknown'}`;
      if (event.event === 'search_performed' || event.event === 'search') {
        const query = clean(props.searchQuery || props.query || props.term);
        if (!query) continue;
        const key = query.toLocaleLowerCase();
        if (!searches.has(key)) searches.set(key, { query, searches: 0, searchers: new Set(), resultCountTotal: 0, resultCountSamples: 0, zeroResultSearches: 0 });
        const row = searches.get(key);
        row.searches += 1; row.searchers.add(userKey); totals.searches += 1; totals.searchers.add(userKey);
        if (props.resultsCount != null && Number.isFinite(Number(props.resultsCount))) {
          const count = Math.max(0, asNumber(props.resultsCount)); row.resultCountTotal += count; row.resultCountSamples += 1;
          if (count === 0) row.zeroResultSearches += 1;
        }
      } else if (['product_view', 'view_item'].includes(event.event)) {
        const id = props.productId ?? (String(event.path || '').match(/products-detail\/(\d+)/) || [])[1];
        if (id == null) continue;
        const row = ensureProduct(id, props);
        row.views += 1; row.uniqueViewers.add(userKey); totals.views += 1; totals.viewers.add(userKey);
      } else if (event.event === 'add_to_cart') {
        const id = props.productId;
        if (id == null) continue;
        const row = ensureProduct(id, props);
        row.cartAdds += 1; row.cartUsers.add(userKey); totals.cartAdds += 1; totals.cartUsers.add(userKey);
      } else if (event.event === 'purchase') {
        const orderId = clean(props.orderId) || String(event._id);
        const lineItems = Array.isArray(props.products) ? props.products : [];
        for (const item of lineItems) {
          const id = item.productId ?? item.id;
          if (id == null) continue;
          totals.orders.add(orderId);
          const row = ensureProduct(id, item);
          const quantity = Math.max(0, asNumber(item.productQuantity ?? item.quantity) || 1);
          const price = Math.max(0, asNumber(item.productPrice ?? item.price) || row.price);
          row.unitsSold += quantity; row.orders.add(orderId); row.revenue += price * quantity;
          totals.unitsSold += quantity; totals.revenue += price * quantity;
          if (!row.price && price) row.price = price;
        }
      }
    }

    const productRows = [...products.values()].map((row) => ({
      productId: row.productId, name: row.name, brand: row.brand, category: row.category, subCategory: row.subCategory,
      price: row.price, views: row.views, uniqueViewers: row.uniqueViewers.size, cartAdds: row.cartAdds,
      cartUsers: row.cartUsers.size, unitsSold: row.unitsSold, orders: row.orders.size, revenue: Math.round(row.revenue * 100) / 100,
      viewToCartRate: row.views ? Math.round((row.cartAdds / row.views) * 1000) / 10 : null,
      cartToPurchaseRate: row.cartAdds ? Math.round((row.unitsSold / row.cartAdds) * 1000) / 10 : null,
    }));
    const sortBy = (field) => [...productRows].sort((a, b) => b[field] - a[field]);
    const searchRows = [...searches.values()].map((row) => ({
      query: row.query, searches: row.searches, uniqueSearchers: row.searchers.size,
      averageResults: row.resultCountSamples ? Math.round((row.resultCountTotal / row.resultCountSamples) * 10) / 10 : null,
      zeroResultSearches: row.zeroResultSearches,
      zeroResultRate: row.resultCountSamples ? Math.round((row.zeroResultSearches / row.resultCountSamples) * 1000) / 10 : null,
    })).sort((a, b) => b.searches - a.searches);

    const opportunities = productRows
      .filter((p) => (p.views >= 3 && p.unitsSold === 0 && p.cartAdds > 0) || (p.views >= 5 && p.unitsSold === 0))
      .map((p) => {
        // Scenario only: assume a 1%-3% incremental conversion improvement on observed views,
        // with current listed product price as a proxy for order value. This is not a forecast.
        const price = Math.max(0, asNumber(p.price));
        const upsideLow = price > 0 ? Math.round(p.views * 0.01 * price) : null;
        const upsideHigh = price > 0 ? Math.round(p.views * 0.03 * price) : null;
        const confidence = p.views >= 100 ? 'High' : p.views >= 30 ? 'Medium' : 'Low';
        const impact = p.views >= 100 ? 'High' : p.views >= 30 ? 'Medium' : 'Low';
        const effort = p.cartAdds > 0 ? 'Medium' : 'Low';
        return {
          productId: p.productId, name: p.name, views: p.views, cartAdds: p.cartAdds, unitsSold: p.unitsSold,
          revenue: p.revenue, price, upsideLow, upsideHigh, confidence, impact, effort,
          priorityScore: (p.views * (p.cartAdds > 0 ? 1.5 : 1)) * (confidence === 'High' ? 1.25 : confidence === 'Medium' ? 1 : 0.75),
          reason: p.cartAdds > 0 ? 'Added to cart but no recorded purchases' : 'High product views with no recorded purchases',
        };
      })
      .sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 6);

    res.json({
      period, range: { from: start.toISOString(), to: end.toISOString() },
      metrics: { searches: totals.searches, uniqueSearchers: totals.searchers.size, productViews: totals.views, uniqueViewers: totals.viewers.size,
        cartAdds: totals.cartAdds, cartUsers: totals.cartUsers.size, orders: totals.orders.size, unitsSold: totals.unitsSold,
        productRevenue: Math.round(totals.revenue * 100) / 100 },
      bestSellers: sortBy('unitsSold').filter((p) => p.unitsSold > 0).slice(0, 8),
      mostViewed: sortBy('views').filter((p) => p.views > 0).slice(0, 8),
      revenueLeaders: sortBy('revenue').filter((p) => p.revenue > 0).slice(0, 8),
      searchTerms: searchRows.slice(0, 12), opportunities,
      coverage: { eventsScanned: events.length, capped: events.length === 50000, hasSearchEvents: totals.searches > 0, hasProductViews: totals.views > 0, hasPurchases: totals.unitsSold > 0 },
    });
  } catch (error) {
    const status = /Unsupported period|Invalid custom|Invalid time|end must be after start/.test(error.message) ? 400 : 500;
    console.error('[product-intelligence] failed', { status, message: error.message });
    res.status(status).json({ error: status === 400 ? error.message : 'Product analytics could not be loaded. Please retry.' });
  }
}

module.exports = { getProductIntelligence };
