const crypto = require('node:crypto');
const { METRICS, STAGE_LABELS } = require('./catalog');
const { sessions, aggregate, metricCards, breakdown, funnel, revenueDrivers } = require('./metrics');

// ---------------------------------------------------------------- formatting
const num = (value, digits = 0) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(value);
function format(value, unit, currency) {
  if (value == null) return 'unavailable';
  if (unit === 'percent') return `${num(value, 1)}%`;
  if (unit === 'money') {
    if (currency) { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value); } catch { /* fall through to a plain number */ } }
    return num(value, 2);
  }
  return num(value, Number.isInteger(value) ? 0 : 1);
}
const size = (value, unit, currency) => unit === 'percent' ? `${num(Math.abs(value), 1)} percentage points` : format(Math.abs(value), unit, currency);
const signed = (value, unit, currency) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${unit === 'percent' ? num(Math.abs(value), 1) : format(Math.abs(value), unit, currency)}`;
const serializeScope = scope => ({ ...scope, start: scope.start.toISOString(), end: scope.end.toISOString(), previousStart: scope.previousStart.toISOString(), previousEnd: scope.previousEnd.toISOString() });

// ------------------------------------------------------------ plain language
// One short sentence per metric; only the ones a question actually uses are returned.
const DEFINITIONS = {
  sessions: 'Sessions are groups of events that share a session ID.',
  users: 'Identified users are signed-in user IDs. Anonymous visitors are not counted, and users are not additive across groups.',
  events: 'Events are all tracked actions in the period.',
  orders: 'Orders are purchase events. Duplicate purchase tracking would inflate them.',
  revenue: 'Revenue is the sum of purchase totals. It is withheld when currencies are mixed or amounts are invalid.',
  aov: 'Average order value is revenue divided by purchase events.',
  conversion: 'Session conversion is sessions with a purchase divided by all sessions.',
  checkout_conversion: 'Checkout completion is sessions that started checkout and then purchased, divided by sessions that started checkout.',
  checkout_abandonment: 'Checkout non-completion is sessions that started checkout but had no later purchase in the period, divided by sessions that started checkout.',
  cart_conversion: 'Cart-to-purchase conversion is sessions that viewed the cart and then purchased, divided by sessions that viewed the cart.',
  product_conversion: 'Product-to-purchase conversion is sessions that viewed a product and then purchased, divided by sessions that viewed a product.',
  add_to_cart_rate: 'Add-to-cart rate is sessions that viewed a product and then added to cart, divided by sessions that viewed a product.',
  page_views: 'Page views count page_view events, grouped into route families.',
  checkout_sessions: 'Checkout sessions are sessions with a checkout_start event.',
  purchasing_sessions: 'Purchasing sessions are sessions with at least one purchase.',
};
function definitionsFor(plan, scope, group) {
  const list = plan.metrics.map(m => DEFINITIONS[m]).filter(Boolean);
  if (plan.mode === 'funnel' || plan.format === 'funnel' || plan.mode === 'diagnose') list.push('Funnel stages must happen in order within one session; other events may happen in between. A session that skips a stage is left out of later stages.');
  if (['device', 'browser', 'source'].includes(group)) list.push('Each session is assigned the first device, browser and traffic source recorded in it. Unknown means the field was not recorded; it does not mean direct traffic.');
  if (group === 'persona' || scope.personas.length) list.push('Personas: loyal = 2+ lifetime purchases; first-time = signed up in the period (not loyal); active = other known users; guest = anonymous. Each session uses its last known identity.');
  if (['day', 'week'].includes(group)) list.push('Each session, including its purchases, is counted on the day or week of its first event. This is not a ledger of purchases by timestamp, and the first and last points can be partial.');
  if (scope.platform !== 'combined') list.push('Web means Desktop sessions; app means Mobile or Tablet sessions.');
  list.push('Periods end at the stated time (exclusive). Counts are sessions, not people.');
  return list;
}

// --------------------------------------------------------- segment diagnosis
function diagnoseSegments(current, previous, dimension, scope, plan, money) {
  const all = breakdown(current, previous, dimension, scope, { ...plan, limit: 20 }, money);
  const metric = plan.metrics[0], unit = METRICS[metric].unit;
  if (unit !== 'percent') return { ...all, rows: all.rows.sort((a, b) => (a.values[metric].absolute ?? Infinity) - (b.values[metric].absolute ?? Infinity)) };
  const totalA = all.rows.reduce((v, row) => v + (row.values[metric].denominator || 0), 0);
  const totalB = all.rows.reduce((v, row) => v + (row.values[metric].previousDenominator || 0), 0);
  if (!totalA || !totalB) return all;
  for (const row of all.rows) {
    const v = row.values[metric];
    const wa = (v.denominator || 0) / totalA, wb = (v.previousDenominator || 0) / totalB;
    const ra = v.current ?? v.previous ?? 0, rb = v.previous ?? v.current ?? 0;
    row.withinContribution = (wa + wb) / 2 * (ra - rb);
    row.mixContribution = (ra + rb) / 2 * (wa - wb);
    row.contribution = row.withinContribution + row.mixContribution;
  }
  all.rows.sort((a, b) => a.contribution - b.contribution);
  all.note += ' Contribution splits the overall rate change into each group’s own performance and its share of traffic. It describes the arithmetic, not the cause.';
  return all;
}

// -------------------------------------------------------------- the answer
function buildAnswer(plan, scope, raw, routing = {}) {
  const a = sessions(raw.current, raw.loyal, scope), b = sessions(raw.previous, raw.loyal, scope);
  const both = [...a.rows, ...b.rows], currencies = [...new Set(both.flatMap(s => [...s.currencies]))];
  const money = currencies.length <= 1 && !both.some(s => s.invalidMoney);
  const currency = currencies.length === 1 && currencies[0] !== 'Unspecified' ? currencies[0] : null;
  const current = aggregate(a.rows, money), previous = aggregate(b.rows, money);
  const comparative = plan.compare !== 'none';
  // `warnings` are things the reader must know to trust the answer; `notes` are technical detail kept behind a toggle.
  const warnings = [], notes = [...scope.notices];
  if (a.missing || b.missing) notes.push(`${a.missing + b.missing} events without a session ID were left out.`);
  if (!money) warnings.push('Revenue figures are hidden because purchase amounts are missing/invalid or use more than one currency. Other measures are unaffected.');
  if (money && !currency && both.some(s => s.orders)) notes.push('Purchase currency is not recorded, so amounts are shown without a currency symbol.');

  let group = plan.groupBy;
  if (plan.mode === 'trend' && !['day', 'week'].includes(group)) group = 'day';
  if (plan.mode === 'diagnose' && group === 'none') group = scope.devices.length === 1 ? 'persona' : 'device';

  const base = { version: 2, id: crypto.randomUUID(), generatedAt: new Date().toISOString(), mode: routing.mode, notice: routing.notice || null, plan, scope: serializeScope(scope), currency, cards: [], blocks: [], context: plan };
  if (!current.sessions) {
    return { ...base, status: 'empty', headline: 'No sessions match these filters in this period.',
      observations: [comparative && previous.sessions ? `The comparison period had ${num(previous.sessions)} matching sessions. Try a longer period or fewer filters.` : 'Try a longer period or fewer filters. This does not mean tracking was working or broken.'],
      warnings: [...new Set(warnings)], notes: [...new Set(notes)], definitions: [], followUps: ['Show daily sessions for the last 30 days', 'Show revenue by persona', 'Why did checkout conversion change this week?'] };
  }

  let cards = metricCards(current, previous, plan).map(c => ({ ...c, basis: METRICS[c.key]?.denominator || null }));
  if (plan.mode === 'funnel') {
    const f = funnel(a.rows, b.rows, plan.funnelStart, comparative);
    const first = f.rows[0], last = f.rows.at(-1), currentRate = last.reach, previousRate = last.previousReach;
    cards = [{ key: 'conversion', label: 'Ordered funnel completion', unit: 'percent', current: currentRate, previous: previousRate,
      absolute: currentRate == null || previousRate == null ? null : currentRate - previousRate,
      relative: currentRate == null || previousRate == null || previousRate === 0 ? null : (currentRate - previousRate) / previousRate * 100,
      numerator: last.current, denominator: first.current, previousNumerator: last.previous, previousDenominator: first.previous,
      basis: `${STAGE_LABELS[plan.funnelStart].toLowerCase()} sessions` }];
  }

  // One consolidated small-sample warning (the weakest figure), instead of one per card and period.
  let weakest = null;
  for (const c of cards) {
    if (c.denominator != null && c.denominator < 30 && (!weakest || c.denominator < weakest.n)) weakest = { n: c.denominator, label: c.label, basis: c.basis || 'sessions', when: 'this period' };
    if (comparative && c.previousDenominator != null && c.previousDenominator < 30 && (!weakest || c.previousDenominator < weakest.n)) weakest = { n: c.previousDenominator, label: c.label, basis: c.basis || 'sessions', when: 'the comparison period' };
  }
  if (weakest) warnings.push(`Small sample: ${weakest.label} is based on only ${num(weakest.n)} ${weakest.basis} in ${weakest.when}, so treat ${comparative ? 'the change' : 'it'} as indicative.`);

  const blocks = [], insights = [], primary = cards[0];
  let headline = `${primary.label}: ${format(primary.current, primary.unit, currency)}`;
  const observations = [];
  if (comparative && primary.absolute != null) {
    const { absolute, previous: before, current: now } = primary;
    headline = absolute === 0
      ? `${primary.label} was unchanged at ${format(now, primary.unit, currency)}.`
      : `${primary.label} ${absolute > 0 ? 'rose' : 'fell'} from ${format(before, primary.unit, currency)} to ${format(now, primary.unit, currency)}.`;
    if (absolute !== 0) observations.push(`${absolute > 0 ? 'Up' : 'Down'} ${size(absolute, primary.unit, currency)}${primary.relative == null ? '' : ` (${signed(primary.relative, 'percent')}%)`} compared with the previous period.`);
  } else if (comparative) observations.push('A comparison is not possible because the previous period has no eligible sessions or valid amounts.');
  if (primary.denominator != null) observations.push(`Based on ${num(primary.numerator)} of ${num(primary.denominator)} ${primary.basis || 'eligible sessions'}${comparative && primary.previousDenominator != null ? ` (previously ${num(primary.previousNumerator)} of ${num(primary.previousDenominator)})` : ''}.`);

  if (plan.mode === 'funnel' || (plan.mode === 'diagnose' && /checkout|cart|product/.test(plan.metrics[0]))) {
    const f = funnel(a.rows, b.rows, plan.funnelStart, comparative); blocks.push({ type: 'funnel', title: 'Where sessions drop off', ...f });
    const eligible = f.rows.slice(1).filter(r => r.stepRate != null && (!comparative || r.previousStepRate != null));
    if (eligible.length > 1) { // a single step is already the headline figure
      const worst = [...eligible].sort((x, y) => comparative ? (x.stepRate - x.previousStepRate) - (y.stepRate - y.previousStepRate) : x.stepRate - y.stepRate)[0];
      const from = f.rows[f.rows.findIndex(r => r.key === worst.key) - 1].label;
      if (comparative && worst.stepRate < worst.previousStepRate) insights.push(`Biggest slip: ${from} → ${worst.label}, down from ${format(worst.previousStepRate, 'percent')} to ${format(worst.stepRate, 'percent')}.`);
      else if (comparative) insights.push('No step in this journey got worse.');
      else insights.push(`Biggest drop-off: ${from} → ${worst.label}, where ${format(worst.stepRate, 'percent')} continue.`);
    }
  }
  if (group !== 'none') {
    const time = ['day', 'week'].includes(group), metric = plan.metrics[0];
    const data = plan.mode === 'diagnose' && comparative && ['device', 'persona'].includes(group) ? diagnoseSegments(a.rows, b.rows, group, scope, plan, money) : breakdown(a.rows, b.rows, group, scope, plan, money);
    blocks.push({ type: plan.format === 'table' ? 'table' : plan.format === 'cards' ? 'groupCards' : plan.format === 'bar' ? 'bar' : time ? 'line' : 'bar', title: `${time ? (group === 'week' ? 'Weekly trend' : 'Daily trend') : `By ${group}`}`, ...data });
    if (['browser', 'source'].includes(group) && data.rows.length && data.rows.every(r => r.key === 'Unknown')) warnings.push(`No ${group} values were recorded for these sessions, so there is nothing to compare.`);
    if (time) {
      const points = data.rows.filter(r => r.values[metric].current != null);
      if (points.length >= 3) {
        const hi = points.reduce((x, y) => y.values[metric].current > x.values[metric].current ? y : x), lo = points.reduce((x, y) => y.values[metric].current < x.values[metric].current ? y : x);
        if (hi !== lo) insights.push(`Highest: ${hi.label} (${format(hi.values[metric].current, METRICS[metric].unit, currency)}). Lowest: ${lo.label} (${format(lo.values[metric].current, METRICS[metric].unit, currency)}).`);
      }
    } else if (data.rows.length) {
      const contributing = data.rows.filter(r => r.contribution != null);
      const worst = contributing.length > 1 ? contributing[0] : null;
      if (worst && worst.contribution < 0) insights.push(`${worst.label} pulled the overall rate down the most (${signed(worst.contribution, 'percent')} points: ${signed(worst.withinContribution, 'percent')} from its own rate, ${signed(worst.mixContribution, 'percent')} from its share of traffic).`);
      else if (['page', 'event'].includes(group)) {
        // A ranking question: lead with the winner rather than a change in the grand total.
        const top = data.rows.find(r => r.values[metric].current != null);
        if (top) { headline = `${top.label} ${group === 'page' ? 'is the most viewed page' : 'is the most frequent event'} (${format(top.values[metric].current, METRICS[metric].unit)}).`; observations.length = 0; }
      } else if (!contributing.length) {
        const ranked = data.rows.filter(r => r.values[metric].current != null).sort((x, y) => y.values[metric].current - x.values[metric].current);
        if (ranked.length > 1) insights.push(`${ranked[0].label} is highest at ${format(ranked[0].values[metric].current, METRICS[metric].unit, currency)}; ${ranked.at(-1).label} is lowest at ${format(ranked.at(-1).values[metric].current, METRICS[metric].unit, currency)}.`);
      }
    }
  }
  if (plan.mode === 'diagnose' && plan.metrics.includes('revenue') && comparative) {
    const drivers = revenueDrivers(current, previous);
    if (drivers.length) {
      blocks.push({ type: 'drivers', title: 'What moved revenue', unit: 'money', rows: drivers, note: 'Contributions come from a sequential split: sessions × conversion × orders per buyer × average order value. They add up to the revenue change; the order of the steps affects how much each one gets.' });
      const top = [...drivers].sort((x, y) => Math.abs(y.value) - Math.abs(x.value))[0];
      if (top && top.value) insights.push(`Largest driver: ${top.label.toLowerCase()} (${signed(top.value, 'money', currency)}).`);
    }
  }
  if (plan.mode === 'diagnose') warnings.push('This shows what changed, not why. Causes such as payment errors or site issues are not tracked here.');
  if (plan.format === 'table' && !blocks.length) blocks.push({ type: 'metricsTable', title: 'Metric comparison', rows: cards });
  if (plan.format === 'bar' && !blocks.length) blocks.push({ type: 'comparison', title: 'Current versus previous', rows: cards });
  if (plan.format === 'funnel' && !blocks.some(x => x.type === 'funnel')) blocks.push({ type: 'funnel', title: 'Where sessions drop off', ...funnel(a.rows, b.rows, plan.funnelStart, comparative) });
  for (const block of blocks) if (block.note) notes.push(block.note);

  // At most three short statements: what changed, what it is based on, and the single most useful insight.
  const lede = observations.slice(0, 2);
  const finalObservations = [...lede, ...insights.slice(0, 3 - lede.length)];

  const ups = [];
  if (scope.devices.length <= 1) ups.push(`What about ${scope.devices[0] === 'Mobile' ? 'desktop' : 'mobile'}?`);
  if (group !== 'persona') ups.push('Break that down by persona');
  if (!['day', 'week'].includes(group)) ups.push('Show that as a daily trend');
  if (primary.unit === 'money' && plan.mode !== 'diagnose') ups.push('Why did revenue change?');
  return { ...base, status: 'answered', headline, observations: finalObservations, cards, blocks, warnings: [...new Set(warnings)], notes: [...new Set(notes)], definitions: definitionsFor(plan, scope, group), followUps: ups.slice(0, 3) };
}
module.exports = { buildAnswer, diagnoseSegments, format };
