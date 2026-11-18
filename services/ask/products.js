// Product-level answers use only recorded events within the selected project and reporting period.
const { sessions } = require('./metrics');
const { error } = require('./catalog');
const catalogue = require('../../data/products');
const rows = Array.isArray(catalogue) ? catalogue : (Array.isArray(catalogue.products) ? catalogue.products : []);
const names = new Map(rows.map(p => [String(p.id ?? p.productId), String(p.name || '').trim()]));
const cleaned = v => typeof v === 'string' ? v.trim().slice(0, 120) : '';
function answerUnpurchasedProducts(plan, scope, raw, routing) {
  // The existing session classifier applies the same device, platform and persona scope as other answers.
  const allowed = new Set(sessions(raw.current, raw.loyal, scope).rows.map(s => s.id));
  const products = new Map();
  let purchases = 0, unitemizedPurchases = 0, viewsWithoutId = 0;
  for (const event of raw.current) {
    if (!event.sessionId || !allowed.has(String(event.sessionId))) continue;
    const props = event.properties || {};
    if (['product_view', 'view_item'].includes(event.event)) {
      const id = props.productId ?? (String(event.path || '').match(/products-detail\/(\d+)/) || [])[1];
      if (id == null || id === '') { viewsWithoutId++; continue; }
      const key = String(id);
      if (!products.has(key)) products.set(key, { key, name: cleaned(props.productName || props.name) || names.get(key) || `Product ${key}`, views: 0, viewers: new Set(), cartAdds: 0, purchases: 0 });
      const row = products.get(key); row.views++; row.viewers.add(String(event.userId || event.sessionId));
      if (row.name.startsWith('Product ')) row.name = cleaned(props.productName || props.name) || names.get(key) || row.name;
    } else if (event.event === 'purchase') {
      purchases++;
      if (!Array.isArray(props.products) || !props.products.length) { unitemizedPurchases++; continue; }
      for (const item of props.products) {
        const id = item?.productId ?? item?.id;
        if (id == null) continue;
        const key = String(id);
        if (!products.has(key)) products.set(key, { key, name: cleaned(item.productName || item.name) || names.get(key) || `Product ${key}`, views: 0, viewers: new Set(), cartAdds: 0, purchases: 0 });
        products.get(key).purchases += Math.max(1, Number(item.productQuantity ?? item.quantity) || 1);
      }
    } else if (event.event === 'add_to_cart') {
      const key = props.productId == null ? null : String(props.productId);
      if (key && products.has(key)) products.get(key).cartAdds++;
    }
  }
  const matches = [...products.values()].filter(p => p.views > 0 && p.purchases === 0).sort((a,b) => b.views-a.views || a.key.localeCompare(b.key));
  const listed = matches.slice(0, plan.limit);
  const warnings = [
    'This report counts product events recorded within the selected period, not all-time product purchase history.',
    ...(unitemizedPurchases ? [`${unitemizedPurchases} purchase events have no product line items, so product-level purchase coverage is incomplete; a zero does not prove a product was never bought.`] : []),
    ...(viewsWithoutId ? [`${viewsWithoutId} product view events had no product ID and could not be matched.`] : []),
    ...(raw.current.length === 0 ? ['No tracked events were found for this period.'] : []),
  ];
  return {
    version: 2, status: 'ready', headline: matches.length ? `${matches.length} products were viewed with no recorded item-level purchases` : 'No viewed products with zero recorded item-level purchases found',
    observations: [matches.length ? `Showing ${listed.length} of ${matches.length} matching products, ranked by recorded views.` : 'No matching products were found in the selected scope. This does not prove every viewed product was bought.'],
    cards: [], blocks: [{ type: 'productTable', title: 'Viewed but not purchased', rows: listed.map(p => ({ productId: p.key, name: p.name, views: p.views, uniqueViewers: p.viewers.size, purchases: 0 })) }],
    warnings, notes: ['Matches are based on productId between product_view/view_item events and purchase products[].productId or id.', 'Guests and identified users are included when they match the selected filters.'],
    definitions: ['A product qualifies if it has at least one recorded view and no matching itemized purchase within the reporting period.'],
    followUps: ['Show the funnel from product view to purchase', 'Show the top 10 pages by page views'],
    scope: { ...scope, start: scope.start.toISOString(), end: scope.end.toISOString(), previousStart: scope.previousStart.toISOString(), previousEnd: scope.previousEnd.toISOString() },
    plan, currency: null, generatedAt: new Date().toISOString(), context: plan, mode: routing.mode, notice: routing.notice || null,
  };
}
module.exports = { answerUnpurchasedProducts };
