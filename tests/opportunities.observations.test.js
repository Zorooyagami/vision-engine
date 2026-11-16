const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function loadWithFixtures(eventRows, behaviorRows = []) {
  const modulePath = path.resolve(__dirname, '../services/opportunities/index.js');
  delete require.cache[modulePath];
  const find = (rows) => () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => rows }) }) }) });
  const Event = { find: find(eventRows) };
  const Behavior = { find: () => ({ select: () => ({ limit: () => ({ lean: async () => behaviorRows }) }) }) };
  const OpportunityStatus = { find: () => ({ lean: async () => [] }) };
  const helpers = { resolveDateRange: () => ({ start: new Date('2026-10-01'), end: new Date('2026-11-01') }),
    applyPlatformDeviceFilter: () => {}, getPersonaUserIds: async () => null, applyPersonaFilter: () => {} };
  const original = Module._load;
  Module._load = function (id, parent, isMain) {
    if (parent?.filename === modulePath) {
      if (id === '../../models/Event') return Event;
      if (id === '../../models/BehaviorEvent') return Behavior;
      if (id === '../../models/OpportunityStatus') return OpportunityStatus;
      if (id === '../filterHelpers') return helpers;
    }
    return original.apply(this, arguments);
  };
  try { return require(modulePath); } finally { Module._load = original; }
}

const ev = (event, sessionId, timestamp, properties = {}) => ({
  event, sessionId, timestamp: new Date(timestamp), properties,
});

test('legacy demo-labelled purchases contribute to tracked value but duplicate IDs do not', async () => {
  const rows = [
    ev('product_view', 'a', '2026-10-02', { productId: 1, name: 'Actual product', title: 'Generic site title' }),
    ev('add_to_cart', 'a', '2026-10-03', { productId: 1 }),
    ev('purchase', 'a', '2026-10-04', { orderId: 'one', environment: 'demo', total: 1000, currency: 'INR' }),
    ev('purchase', 'a', '2026-10-05', { orderId: 'one', environment: 'demo', total: 1000, currency: 'INR' }),
  ];
  const radar = await loadWithFixtures(rows).buildRadar({ projectId: 'demo' });
  assert.deepEqual(radar.summary.trackedPurchaseValues, [{ currency: 'INR', amount: 1000 }]);
  assert.equal(radar.summary.quality.duplicatePurchaseEvents, 1);
  assert.equal(radar.summary.purchaseSessions, 1);
  assert.equal(radar.summary.viewToCartSessions, 1);
  assert.ok(!JSON.stringify(radar).includes('potential'));
});

test('production-tagged purchases are deduped and currencies remain distinct', async () => {
  const rows = [
    ev('purchase', 'a', '2026-10-02', { orderId: 'one', environment: 'production', total: '23.50', currency: 'USD' }),
    ev('purchase', 'b', '2026-10-03', { orderId: 'two', environment: 'production', total: 100, currency: 'INR' }),
    ev('purchase', 'a', '2026-10-04', { orderId: 'one', environment: 'production', total: 50, currency: 'USD' }),
    ev('purchase', 'c', '2026-10-05', { orderId: 'three', environment: 'production', total: 40 }),
  ];
  const radar = await loadWithFixtures(rows).buildRadar({ projectId: 'prod' });
  assert.deepEqual(radar.summary.trackedPurchaseValues, [{currency: 'USD', amount: 23.5}, {currency: 'INR', amount: 100}]);
  assert.equal(radar.summary.quality.duplicatePurchaseEvents, 1);
  assert.equal(radar.summary.quality.missingCurrencyOrAmount, 1);
});

test('product name comes from product field, never the document title', async () => {
  const rows = Array.from({length: 25}, (_, i) =>
    ev('product_view', `s-${i}`, '2026-10-02', { productId: 'a1', name: 'Headphones', title: 'ShopEasy - Ecommerce' }));
  const radar = await loadWithFixtures(rows).buildRadar({ projectId: 'demo' });
  assert.equal(radar.opportunities.length, 1);
  assert.match(radar.opportunities[0].title, /Headphones/);
  assert.ok(!radar.opportunities[0].title.includes('ShopEasy'));
  assert.equal(radar.opportunities[0].evidence[0].value, 25);
});

test('refuses to create misleading reports from truncated event samples', async () => {
  const rows = Array.from({length: 50001}, () => ev('product_view', 's', '2026-10-02', {productId: 'p'}));
  await assert.rejects(() => loadWithFixtures(rows).buildRadar({ projectId: 'big' }), { status: 413 });
});

test('generic site title is never presented as a product name, and threshold is explained', async () => {
  const rows = Array.from({ length: 24 }, (_, i) => ev('product_view', `s-${i}`, '2026-10-02', {
    productId: 'sku-21', name: 'ShopEasy - Ecommerce', title: 'ShopEasy - Ecommerce',
  }));
  const radar = await loadWithFixtures(rows).buildRadar({ projectId: 'demo' });
  const signal = radar.opportunities[0];
  assert.match(signal.title, /Product ID: sku-21/);
  assert.doesNotMatch(signal.title, /ShopEasy/);
  assert.match(signal.summary, /0 of 24/);
  assert.match(signal.detectionRule, /Observed: 24 sessions and 0%/);
  assert.equal(signal.productId, 'sku-21');
});

test('product insight changes with real counts and is not generated when evidence threshold is not met', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ev('product_view', `s-${i}`, '2026-10-02', {
    productId: 'keyboard', productName: 'Mechanical Keyboard',
  }));
  rows.push(ev('add_to_cart', 's-0', '2026-10-03', { productId: 'keyboard' }));
  const radar = await loadWithFixtures(rows).buildRadar({ projectId: 'demo' });
  assert.match(radar.opportunities[0].title, /3\.3%.*30 sessions/);
  assert.match(radar.opportunities[0].summary, /1 of 30/);
  assert.equal(radar.opportunities[0].evidence[1].value, 1);
  const small = await loadWithFixtures(rows.slice(0, 15)).buildRadar({ projectId: 'demo' });
  assert.ok(small.opportunities.some((o) => o.evidenceLevel === 'exploratory'));
  assert.equal(small.summary.actionableSignals, 0);
});


test('six-month-like small samples yield real exploratory snapshots without fabricated revenue or strong claims', async () => {
  const rows = [
    ev('product_view', 'a', '2026-10-02', {productId: 'p1', productName: 'Blue Jacket'}),
    ev('product_view', 'b', '2026-10-02', {productId: 'p2', productName: 'Red Jacket'}),
    ev('product_view', 'c', '2026-10-02', {productId: 'p3'}),
    ev('add_to_cart', 'a', '2026-10-03', {productId: 'p1'}),
    ev('checkout_start', 'a', '2026-10-04'),
  ];
  const data = await loadWithFixtures(rows).buildRadar({projectId: 'demo', period: '180d'});
  assert.equal(data.summary.actionableSignals, 0);
  assert.equal(data.summary.exploratoryObservations, 5);
  assert.ok(data.opportunities.every(o => o.evidenceLevel === 'exploratory'));
  assert.deepEqual(data.summary.trackedPurchaseValues, []);
  assert.ok(data.opportunities.every(o => !/revenue upside|strong conversion/i.test(o.title)));
});

test('empty project produces no fabricated records or observations', async () => {
  const data = await loadWithFixtures([]).buildRadar({projectId: 'empty'});
  assert.equal(data.summary.actionableSignals, 0);
  assert.equal(data.summary.exploratoryObservations, 0);
  assert.equal(data.opportunities.length, 0);
});
