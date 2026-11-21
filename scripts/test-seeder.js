'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {generate,buildCatalog,IGNORE,parseArgs}=require('./seed-vision');
const sample=JSON.parse(fs.readFileSync(path.join(__dirname,'sample-events.json'),'utf8'));
const catalog=buildCatalog(sample);
assert.ok(catalog.length>=8,'sufficient catalog');
const users=Array.from({length:100},(_,i)=>({userId:'demo_'+i}));
const opts={users,catalog,projectId:'vis_test',currency:'USD',batch:'test_v1',endDate:'2026-11-20',days:183};
const a=generate(opts), b=generate(opts);
assert.deepEqual(a.events,b.events,'seed is deterministic');
assert.equal(a.assignments.length,100);
assert.equal(a.stats.foreignUsers,25);
assert.equal(new Set(a.events.map(e=>e.userId)).size,100,'all 100 users are represented');
assert.equal(new Set(a.events.map(e=>e._id)).size,a.events.length,'unique event IDs');
assert.equal(new Set(a.events.filter(e=>e.event==='purchase').map(e=>e.properties.orderId)).size,a.stats.purchases);
assert.ok(a.events.every(e=>e.isSynthetic && e.seedBatchId===opts.batch && !IGNORE.has(e.event)));
assert.ok(a.events.every(e=>e.projectId===opts.projectId));
assert.ok(a.events.every(e=>e.timestamp>=new Date(a.start)&&e.timestamp<new Date(a.end)));
const bySession=new Map();
for(const e of a.events){if(!bySession.has(e.sessionId))bySession.set(e.sessionId,[]);bySession.get(e.sessionId).push(e);}
for(const arr of bySession.values()) {
 assert.ok(arr.every((e,i)=>!i || arr[i-1].timestamp <= e.timestamp),'ordered journey');
 const purchase=arr.findIndex(e=>e.event==='purchase');
 if(purchase>=0){
  const cart=arr.findIndex(e=>e.event==='add_to_cart');
  const checkout=arr.findIndex(e=>e.event==='checkout_start');
  const shipping=arr.findIndex(e=>e.event==='shipping_details');
  assert.ok(cart>=0&&cart<checkout&&checkout<shipping&&shipping<purchase,'ordered checkout to purchase');
  assert.equal(arr[purchase].properties.products[0].productId,arr[cart].properties.productId);
 }
}
assert.ok(Object.keys(a.stats.byDay).length===183);
assert.ok(Object.values(a.stats.byDay).some(d=>d.revenue===0));
assert.ok(Object.values(a.stats.byDay).some(d=>d.revenue>0));
assert.equal(a.events.filter(e=>e.event==='purchase').length,a.stats.purchases);
assert.equal(a.stats.events,a.events.length);
assert.deepEqual(parseArgs(['--project','vis_123','--currency','USD','--days','183']).days,183);
console.log('PASS: deterministic output; 100 existing user IDs; 25 foreign; 183 days; idempotent IDs; consistent purchase journeys; ignored events excluded.');
console.log(JSON.stringify({sessions:a.stats.sessions,events:a.stats.events,purchases:a.stats.purchases,foreignUsers:a.stats.foreignUsers,catalog:catalog.length}));
