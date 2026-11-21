'use strict';
const assert=require('node:assert/strict');
const s=require('../seed-persona-balanced-journeys');
const products=s.catalog(require('node:path').join(__dirname,'..','products.js'));
assert.equal(products.length,100);
const o={project:'vis_6bcd1aef732e0d5d',batch:'devday_persona_balance_v3',asOf:'2026-11-21T10:00:00Z',days:180,firsttime:30,active:30};
const a=s.makeDocs(o,products),b=s.makeDocs(o,products);
assert.deepEqual(a.docs,b.docs,'deterministic generation');
assert.equal(a.summary.newSyntheticUsers.firsttime,30);
assert.equal(a.summary.newSyntheticUsers.active,30);
assert.equal(a.summary.purchases.firsttime,25);
assert.equal(a.summary.purchases.active,25);
assert.equal(new Set(a.docs.map(d=>d._id)).size,a.docs.length,'distinct event ids');
const buyers={};let firstRecent=0,activeRecent=0;
for(const d of a.docs){
 assert.equal(d.isSynthetic,true);assert.equal(d.seedBatchId,o.batch);assert.ok(d.timestamp<=new Date(o.asOf));
 if(d.event==='purchase'){
  buyers[d.userId]=(buyers[d.userId]||0)+1;
  assert.ok(Number(d.properties.total)>0);
  assert.ok(d.properties.orderId&&d.properties.cartId&&d.properties.products.length);
  if(d.timestamp>=new Date(Date.parse(o.asOf)-86400000)){
   if(d.seedScenario==='firsttime')firstRecent++;else activeRecent++;
  }
 }
}
assert.ok(Math.max(...Object.values(buyers))===1,'no loyal conversion');
assert.ok(firstRecent>=1&&activeRecent>=1,'both cohorts buy in 1-day window');
for(const person of ['active','firsttime']){
 const signups=a.docs.filter(d=>d.seedScenario===person&&d.event==='sign_up');
 if(person==='active')assert.ok(signups.every(d=>d.timestamp<new Date(Date.parse(o.asOf)-o.days*86400000)),'active signup before window');
 else assert.ok(signups.every(d=>d.timestamp>=new Date(Date.parse(o.asOf)-o.days*86400000)),'firsttime signup within window');
}
assert.ok(a.docs.some(d=>d.event==='payment_failed'));
assert.ok(a.docs.some(d=>d.event==='checkout_step_error'));
assert.ok(a.docs.some(d=>d.event==='product_stock_unavailable'));
console.log('PASS: catalogue, 60 isolated synthetic identities, stable seeds, distinct events, 50 one-order buyers, first-time/active rules, decision friction, recent purchases');
