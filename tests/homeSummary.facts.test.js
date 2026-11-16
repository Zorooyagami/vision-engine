const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../services/intelligence/homeSummary.js'), 'utf8');
let capture;
let response;
const fakeEvent = { aggregate(pipeline) { capture = pipeline; return { option: async () => response }; } };
const f = { start: new Date('2026-06-01'), end: new Date('2026-11-17'), projectId:'vis_test', platform:'combined' };
const moduleStub = {exports:{}};
vm.runInNewContext(source, {
 module:moduleStub, exports:moduleStub.exports, console,
 require(id) {
  if (id==='../../models/Event') return fakeEvent;
  if (id==='../exploreFilters') return {readReportingFilters: req => ({...f,start:req.start || f.start})};
  if (id==='../filterHelpers') return {applyPlatformDeviceFilter:()=>{}};
  throw new Error(id);
 }
});
const {buildHomeFacts,getHomeSummary} = moduleStub.exports;
test('facts are derived from actual observed metrics, not a fixed two-item list', () => {
 const facts = buildHomeFacts({sessions:20,events:90,pageSessions:20,pageViews:50,productSessions:10,cartSessions:6,cartEvents:8,checkoutSessions:4,purchasingSessions:3,purchaseEvents:5,identifiedSessions:15,customEvents:7});
 assert.ok(facts.length>2);assert.match(facts.find(f=>f.id==='purchases').text,/5 purchase events/);
 assert.equal(facts.find(f=>f.id==='carts').title,'6 sessions added to cart');
});
test('no observations means no inferred findings',()=>assert.equal(buildHomeFacts({sessions:0}).length,0));
test('stage findings only appear when stage events were actually observed',()=>{
 const facts=buildHomeFacts({sessions:2,events:2,identifiedSessions:0,purchasingSessions:0});
 assert.ok(!facts.some(f=>['carts','checkout','purchases','products'].includes(f.id)));
});
test('backend query uses selected period and project; no fixed fact cap',async()=>{
 response=[{sessions:2,events:10,pageSessions:2,pageViews:6,purchasingSessions:1,purchaseEvents:2,identifiedSessions:1}];
 const result=await getHomeSummary({start:new Date('2026-01-01')});
 assert.equal(capture[0].$match.projectId,'vis_test');
 assert.equal(capture[0].$match.timestamp.$gte.toISOString(),'2026-01-01T00:00:00.000Z');
 assert.equal(result.current.purchaseEvents,2);
 assert.ok(result.facts.length>2);
});
