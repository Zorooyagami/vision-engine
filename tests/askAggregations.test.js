const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateQuerySpec, buildPipeline } = require('../services/ask/queryCompiler');
const { rules, validatePlan } = require('../services/ask/planner');
const { resolveScope } = require('../services/ask/dates');
const scope = { projectId: 'own-project', start: new Date('2026-01-01'), end: new Date('2026-03-01'), timezone: 'UTC', platform: 'combined', devices: [], personas: [] };
test('compiler rejects arbitrary query injection and always isolates project and time', () => {
  for (const q of [ { measure:'$where',groupBy:'none' }, { measure:'count_events',groupBy:'$group' }, { measure:'count_events',groupBy:'none',filter:{ $where:'1'} }, { measure:'sum_purchase_total',groupBy:'none',eventName:'page_view' } ]) assert.throws(() => validateQuerySpec(q));
  assert.throws(() => buildPipeline({measure:'count_events',groupBy:'event',eventName:'unregistered'},scope, []));
  const p = buildPipeline({ measure:'count_events',groupBy:'hour_of_day', eventName:'checkout_click' },scope,['checkout_click']);
  assert.equal(p[0].$match.projectId,'own-project'); assert.equal(p[0].$match.event,'checkout_click'); assert.deepEqual(p[0].$match.timestamp,{$gte:scope.start,$lt:scope.end});
  assert.equal(p.at(-1).$limit,24);
});
test('distinct people are deduplicated with two grouping stages, no addToSet', () => {
  const p = buildPipeline({ measure:'distinct_users',groupBy:'device' },scope,[]);
  assert.equal(p.filter(x=>x.$group).length,2);
  assert.equal(JSON.stringify(p).includes('$addToSet'),false);
});
test('custom event query and month/year date interpretations are bounded', () => {
  const p = rules('How many checkout_click events by hour last 6 months?',null,[{name:'checkout_click'}]);
  assert.equal(p.mode,'aggregate_query'); assert.equal(p.query.eventName,'checkout_click'); assert.equal(p.query.groupBy,'hour_of_day'); assert.equal(p.months,6);
  const yearly = rules('How many purchases this year?'); assert.equal(yearly.period,'this_year');
  const annual = rules('How many purchases in the last 12 months?'); assert.equal(annual.months,12);
  assert.doesNotThrow(()=>validatePlan({ days:365 })); assert.throws(()=>validatePlan({ days:366 }));
  const range = resolveScope({ ...annual, compare:'none' }, { ...scope, end:new Date('2026-11-19') },'UTC',new Date('2026-11-19'));
  assert.ok(range.end-range.start <= 365*86400000);
});
