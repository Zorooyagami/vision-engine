const { METRICS, STAGES, STAGE_LABELS } = require('./catalog');
const { localDate, shiftDate } = require('./dates');
const rate = (a, b) => b ? a / b * 100 : null;
const labels = { loyal: 'Loyal', firsttime: 'First-time', active: 'Active', guest: 'Guest' };
function cleanDimension(value) { const v = typeof value === 'string' ? value.trim() : ''; return /^[\w .()\/-]{1,60}$/.test(v) ? v : 'Unknown'; }
function pageGroup(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return 'Unknown';
  // Report route families only; never expose query strings or identifiers in paths.
  const root = value.split(/[?#]/)[0].split('/').filter(Boolean)[0];
  const allowed = ['products', 'products-detail', 'product', 'cart', 'payment', 'checkout', 'confirmation', 'login', 'signup', 'search', 'account'];
  return !root ? '/' : allowed.includes(root) ? `/${root}${value.split(/[?#]/)[0].split('/').filter(Boolean).length > 1 ? '/*' : ''}` : '/other';
}
function sessions(events, loyal, scope) {
  const firsttime = new Set(events.filter(e => e.event === 'sign_up' && e.userId).map(e => String(e.userId)));
  const map = new Map(); let missing = 0;
  for (const e of events) {
    if (!e.sessionId) { missing++; continue; }
    const id = String(e.sessionId);
    if (!map.has(id)) map.set(id, { id, user: null, start: new Date(e.timestamp), device: 'Unknown', browser: 'Unknown', source: 'Unknown', events: [], orders: 0, revenue: 0, invalidMoney: false, currencies: new Set() });
    const s = map.get(id); if (e.userId) s.user = String(e.userId);
    const device = ['Desktop', 'Mobile', 'Tablet'].find(d => d.toLowerCase() === String(e.deviceInfo?.deviceType || '').toLowerCase());
    if (s.device === 'Unknown' && device) s.device = device;
    if (s.browser === 'Unknown') s.browser = cleanDimension(e.browser);
    if (s.source === 'Unknown') s.source = cleanDimension(e.trafficSource);
    s.events.push({ name: String(e.event), page: e.event === 'page_view' ? pageGroup(e.path) : null });
    if (e.event === 'purchase') {
      s.orders++; const total = e.properties?.total;
      if ((typeof total !== 'number' && typeof total !== 'string') || String(total).trim() === '' || !Number.isFinite(Number(total)) || Number(total) < 0) s.invalidMoney = true; else s.revenue += Number(total);
      const currency = String(e.properties?.currency || process.env.DASHBOARD_CURRENCY || '').toUpperCase(); s.currencies.add(/^[A-Z]{3}$/.test(currency) ? currency : 'Unspecified');
    }
  }
  const rows = [...map.values()].map(s => ({ ...s, persona: !s.user ? 'guest' : loyal.has(s.user) ? 'loyal' : firsttime.has(s.user) ? 'firsttime' : 'active' })).filter(s =>
    (!scope.devices.length || scope.devices.includes(s.device)) && (!scope.personas.length || scope.personas.includes(s.persona)) && (scope.platform === 'web' ? s.device === 'Desktop' : scope.platform === 'app' ? ['Mobile', 'Tablet'].includes(s.device) : true));
  return { rows, missing };
}
function ordered(s, stages) { let index = 0; for (const e of s.events) if (e.name === stages[index]) { index++; if (index === stages.length) return true; } return false; }
function aggregate(rows, money = true) {
  const has = name => rows.filter(s => s.events.some(e => e.name === name));
  const checkout = has('checkout_start'), cart = has('view_cart'), product = has('product_view');
  const completed = (group, steps) => group.filter(s => ordered(s, steps)).length;
  const checkoutDone = completed(checkout, ['checkout_start', 'purchase']);
  const orders = rows.reduce((n, s) => n + s.orders, 0), purchasing = rows.filter(s => s.orders).length;
  const revenue = money ? rows.reduce((n, s) => n + s.revenue, 0) : null;
  return { sessions: rows.length, users: new Set(rows.filter(s => s.user).map(s => s.user)).size, events: rows.reduce((n, s) => n + s.events.length, 0), orders, purchasing_sessions: purchasing, revenue, aov: money && orders ? revenue / orders : null,
    conversion: rate(purchasing, rows.length), checkout_conversion: rate(checkoutDone, checkout.length), checkout_abandonment: checkout.length ? 100 - rate(checkoutDone, checkout.length) : null,
    cart_conversion: rate(completed(cart, ['view_cart', 'purchase']), cart.length), product_conversion: rate(completed(product, ['product_view', 'purchase']), product.length), add_to_cart_rate: rate(completed(product, ['product_view', 'add_to_cart']), product.length),
    page_views: rows.reduce((n, s) => n + s.events.filter(e => e.name === 'page_view').length, 0), checkout_sessions: checkout.length,
    denominators: { conversion: rows.length, checkout_conversion: checkout.length, checkout_abandonment: checkout.length, cart_conversion: cart.length, product_conversion: product.length, add_to_cart_rate: product.length },
    numerators: { conversion: purchasing, checkout_conversion: checkoutDone, checkout_abandonment: checkout.length - checkoutDone, cart_conversion: completed(cart, ['view_cart', 'purchase']), product_conversion: completed(product, ['product_view', 'purchase']), add_to_cart_rate: completed(product, ['product_view', 'add_to_cart']) } };
}
function change(current, previous) { return { absolute: current == null || previous == null ? null : current - previous, relative: current == null || previous == null || previous === 0 ? null : (current - previous) / Math.abs(previous) * 100 }; }
function metricCards(a, b, plan) { return plan.metrics.map(key => ({ key, ...METRICS[key], current: a[key], previous: plan.compare === 'none' ? null : b[key], ...change(a[key], plan.compare === 'none' ? null : b[key]), numerator: a.numerators[key], denominator: a.denominators[key], previousNumerator: b.numerators[key], previousDenominator: b.denominators[key] })); }
function groupRows(rows, dimension, zone) {
  const groups = new Map(); const add = (key, s) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(s); };
  for (const s of rows) {
    if (dimension === 'page' || dimension === 'event') {
      const groupsForSession = new Map(); for (const e of s.events) { if (dimension === 'page' && e.name !== 'page_view') continue; const key = dimension === 'page' ? e.page : cleanDimension(e.name); if (!groupsForSession.has(key)) groupsForSession.set(key, []); groupsForSession.get(key).push(e); }
      for (const [key, events] of groupsForSession) add(key, { ...s, events });
    } else if (dimension === 'day' || dimension === 'week') {
      let date = localDate(s.start, zone); if (dimension === 'week') date = shiftDate(date, -((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7)); add(date, s);
    } else add(s[dimension] || 'Unknown', s);
  }
  return groups;
}
function breakdown(a, b, dimension, scope, plan, money) {
  const current = groupRows(a, dimension, scope.timezone), previous = groupRows(b, dimension, scope.timezone);
  let keys = [...new Set([...current.keys(), ...previous.keys()])];
  const time = ['day', 'week'].includes(dimension);
  if (time) {
    // One point per current calendar bucket; prior series is deliberately omitted.
    let day = localDate(scope.start, scope.timezone), end = localDate(new Date(+scope.end - 1), scope.timezone);
    if (dimension === 'week') day = shiftDate(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
    keys = []; for (let i = 0; day <= end && i < 185; i++, day = shiftDate(day, dimension === 'week' ? 7 : 1)) keys.push(day);
  }
  const rows = keys.map(key => { const ca = aggregate(current.get(key) || [], money), cb = aggregate(previous.get(key) || [], money); return { key, label: labels[key] || key, sessions: ca.sessions, previousSessions: cb.sessions, values: Object.fromEntries(plan.metrics.map(m => [m, { current: ca[m], previous: time || plan.compare === 'none' ? null : cb[m], ...change(ca[m], time || plan.compare === 'none' ? null : cb[m]), denominator: ca.denominators[m], previousDenominator: cb.denominators[m] }])) }; });
  if (!time) rows.sort((x, y) => { const a = x.values[plan.metrics[0]].current, b = y.values[plan.metrics[0]].current; return a == null ? 1 : b == null ? -1 : (plan.sort === 'asc' ? 1 : -1) * (a - b); });
  return { dimension, metrics: plan.metrics, totalGroups: rows.length, rows: time ? rows : rows.slice(0, plan.limit), truncated: !time && rows.length > plan.limit, note: time ? 'Session-based metrics are assigned to the first observed event date. Purchase totals include all purchase events in those sessions. Boundary buckets can be partial.' : 'Each session uses its first recognized device/browser/source and last known user. Rate changes are percentage points.' };
}
function funnel(a, b, start, compare) {
  const stages = STAGES.slice(STAGES.indexOf(start));
  const counts = rows => stages.map((_, i) => rows.filter(s => ordered(s, stages.slice(0, i + 1))).length);
  const ca = counts(a), cb = counts(b);
  return { start, rows: stages.map((stage, i) => ({ key: stage, label: STAGE_LABELS[stage], current: ca[i], previous: compare ? cb[i] : null, reach: rate(ca[i], ca[0]), previousReach: compare ? rate(cb[i], cb[0]) : null, stepRate: i ? rate(ca[i], ca[i - 1]) : null, previousStepRate: compare && i ? rate(cb[i], cb[i - 1]) : null, lost: i ? ca[i - 1] - ca[i] : 0 })), note: 'Ordered stages within one session and reporting window; intervening events are allowed. Skipping a listed stage excludes the session from later steps. Counts are sessions, not people.' };
}
function revenueDrivers(a, b) {
  const factors = m => [m.sessions, m.sessions ? m.purchasing_sessions / m.sessions : 0, m.purchasing_sessions ? m.orders / m.purchasing_sessions : 0, m.aov || 0];
  if (a.revenue === null || b.revenue === null) return [];
  const before = factors(b), after = factors(a), names = ['Session volume', 'Session conversion', 'Orders per purchasing session', 'Average order value'];
  return names.map((label, i) => ({ label, value: (after[i] - before[i]) * after.slice(0, i).reduce((p, v) => p * v, 1) * before.slice(i + 1).reduce((p, v) => p * v, 1) }));
}
module.exports = { sessions, aggregate, ordered, metricCards, breakdown, funnel, revenueDrivers, change, cleanDimension, pageGroup };
