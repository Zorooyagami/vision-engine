// Bounded, server-owned answers. No generated queries and no fabricated user/product attribution.
const { sessions } = require('./metrics');
const catalogue = require('../../data/products');
const products = Array.isArray(catalogue) ? catalogue : (catalogue.products || []);
const names = new Map(products.map(p => [String(p.id ?? p.productId), String(p.name || '')]));
const label = x => typeof x === 'string' && x.trim() ? x.trim().slice(0, 100).replace(/[\x00-\x1f]/g, '') : 'Unknown';
const num = x => (typeof x === 'number' || typeof x === 'string') && String(x).trim() !== '' && Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : null;
const scopeJSON = s => ({ ...s, start: s.start.toISOString(), end: s.end.toISOString(), previousStart: s.previousStart.toISOString(), previousEnd: s.previousEnd.toISOString() });
function answerSpecialist(plan, scope, raw, routing) {
  const permitted = new Set(sessions(raw.current, raw.loyal, scope).rows.map(x => x.id));
  const events = raw.current.filter(e => e.sessionId && permitted.has(String(e.sessionId)));
  const warnings = [];
  const notes = ['Only recorded events for the selected project and audience filters are considered.'];
  if (plan.period === 'all_time') warnings.push('Lifetime means all available recorded events, not activity before SDK installation.');
  if (!events.length) warnings.push('No matching tracked events were found in this period.');
  let title = '', headers = [], rows = [], definitions = [], followUps = [];
  if (plan.mode === 'audience_city' || plan.mode === 'audience_device') {
    const dimension = plan.mode === 'audience_city' ? 'City' : 'Device';
    const grouped = new Map(), usersByGroup = new Map();
    const eventBySession = new Map();
    for (const e of events) { const id = String(e.sessionId); if (!eventBySession.has(id)) eventBySession.set(id, []); eventBySession.get(id).push(e); }
    const sessionRows = sessions(raw.current, raw.loyal, scope).rows;
    for (const session of sessionRows) {
      const evs = eventBySession.get(session.id) || [];
      const geo = evs.map(e => e.deviceInfo?.geo || e.deviceInfo?.location || {}).find(g => g.city || g.country) || {};
      const first = evs.find(e => e.deviceInfo?.city || e.deviceInfo?.geo?.city || e.deviceInfo?.geo?.country || e.deviceInfo?.country);
      const city = label(geo.city || first?.deviceInfo?.city);
      const country = label(geo.country || first?.deviceInfo?.country);
      const key = dimension === 'Device' ? session.device : city === 'Unknown' ? 'Unknown' : `${city}${country !== 'Unknown' ? ', ' + country : ''}`;
      if (!grouped.has(key)) grouped.set(key, new Set());
      grouped.get(key).add(session.id);
      if (!usersByGroup.has(key)) usersByGroup.set(key, new Set());
      // Without a userId, sessions are counted as sessions, not unique anonymous people.
      if (session.user) usersByGroup.get(key).add(session.user);
    }
    title = dimension === 'City' ? 'Audience by recorded city' : 'Desktop vs mobile audience';
    headers = [dimension, 'Identified users', 'Sessions'];
    rows = [...grouped].map(([key, ids]) => ({ cells: [key, usersByGroup.get(key).size, ids.size], sort: usersByGroup.get(key).size })).sort((a,b) => b.sort-a.sort || b.cells[2]-a.cells[2] || String(a.cells[0]).localeCompare(String(b.cells[0]))).slice(0, plan.limit);
    definitions = ['Ranked by distinct identified user IDs, with session count as a tie-breaker. Identified users can appear in multiple groups. Anonymous visitors are counted only as sessions and cannot be deduplicated into unique users.'];
    if (!sessionRows.some(s => s.user)) warnings.push('No identified users exist in this selection; groups are effectively ranked by session count.');
    if (dimension === 'City') warnings.push('City is read only from tracked deviceInfo.geo.city or deviceInfo.city. Unknown locations remain Unknown; IP addresses are not exposed or geolocated here.');
    else notes.push('Device is taken from the first recognized device type in each session.');
    followUps = ['Which device has most sessions?', 'Which city has most users?'];
  } else if (plan.mode === 'top_spenders') {
    const spending = new Map(), currencies = new Set(); let invalid = 0, unknown = 0;
    for (const e of events) if (e.event === 'purchase') {
      if (!e.userId || String(e.userId).startsWith('guest_')) { unknown++; continue; }
      const p = e.properties || {};
      const amount = num(p.total ?? p.totalAmount ?? p.orderTotal ?? p.revenue ?? p.value ?? e.amount);
      // Do not guess monetary units from locale, IP address or product prices.
      const currency = label(p.currency || p.currencyCode || e.currency || process.env.DASHBOARD_CURRENCY).toUpperCase();
      if (amount === null || !/^[A-Z]{3}$/.test(currency)) { invalid++; continue; }
      currencies.add(currency);
      const id = String(e.userId);
      if (!spending.has(id)) spending.set(id, { amount: 0, orders: 0 });
      const rec = spending.get(id); rec.amount += amount; rec.orders++;
    }
    title = 'Highest recorded customer spend'; headers = ['User ID', 'Completed purchase events', 'Recorded spend', 'Currency'];
    if (currencies.size > 1) warnings.push('Multiple currencies were recorded. Amounts cannot be ranked together without exchange-rate conversion.');
    else rows = [...spending].map(([id,v]) => ({ cells: [id.slice(0,100), v.orders, Math.round(v.amount*100)/100, [...currencies][0] || ''], sort: v.amount })).sort((a,b) => b.sort-a.sort).slice(0,plan.limit);
    if (invalid) warnings.push(`${invalid} purchase event(s) lack valid amount or currency and are excluded. If all purchases use a single known currency, configure DASHBOARD_CURRENCY on the backend or track properties.currency in the SDK.`);
    if (unknown) warnings.push(`${unknown} guest/anonymous purchase event(s) cannot be attributed to a known customer.`);
    definitions = ['Sum of tracked purchase event totals per identified user, before any refunds or cancellations. Repeated or duplicated purchase events can inflate results.'];
    followUps = ['Show revenue by persona', 'Which products were viewed but never bought?'];
  } else {
    const remove = plan.mode === 'product_cart_removals';
    const matched = remove ? new Set(['remove_from_cart', 'cart_remove', 'remove_cart_item']) : new Set(['add_to_cart']);
    const grouped = new Map(); let withoutId = 0;
    for (const e of events) {
      if (!matched.has(e.event)) continue;
      const data = e.properties || {};
      const id = data.productId ?? data.id ?? data.product?.productId ?? data.product?.id;
      if (id == null || String(id).trim() === '') { withoutId++; continue; }
      const key = String(id);
      if (!grouped.has(key)) grouped.set(key, { name: label(data.productName || data.name || data.product?.name || names.get(key)), events: 0, quantity: 0, sessions: new Set() });
      const item = grouped.get(key); item.events++; item.quantity += num(data.quantity ?? data.productQuantity) ?? 1; item.sessions.add(String(e.sessionId));
    }
    title = remove ? 'Most frequently removed from carts' : 'Most frequently added to carts';
    headers = ['Product', 'Product ID', 'Cart events', 'Total reported quantity', 'Sessions'];
    rows = [...grouped].map(([id,v]) => ({ cells: [v.name,id,v.events,v.quantity,v.sessions.size], sort:v.events })).sort((a,b) => b.sort-a.sort || String(a.cells[1]).localeCompare(String(b.cells[1]))).slice(0,plan.limit);
    if (withoutId) warnings.push(`${withoutId} cart events did not contain a product ID and were excluded.`);
    definitions = [`Ranked by recorded ${remove ? 'remove-from-cart' : 'add-to-cart'} event count. Multiple actions by the same user are counted separately; total quantity is shown independently.`];
    followUps = remove ? ['Which products are added to cart most?', 'Which products were viewed but never bought?'] : ['Which product is removed from cart the most in lifetime?', 'Which products were viewed but never bought?'];
    notes.push('Cart actions require explicit SDK event tracking; a missing action does not prove that no user performed it.');
  }
  return { version:2, status:rows.length?'ready':'empty', headline:rows.length ? title : `No usable data for ${title.toLowerCase()}`, observations:[rows.length ? `Showing ${rows.length} ranked result(s) from the tracked dataset.` : 'No matching records with the required fields were found.'], cards:[], blocks:rows.length ? [{ type:'analyticsTable', title, columns:headers, rows:rows.map(r=>r.cells) }] : [], warnings, notes, definitions, followUps, scope:scopeJSON(scope), plan, currency:null, generatedAt:new Date().toISOString(), context:plan, mode:routing.mode, notice:routing.notice || null };
}
module.exports = { answerSpecialist };
