const {test}=require('node:test');const assert=require('node:assert/strict');
const {normalizeEvent,analyze,membersFor,validateRule}=require('../services/behavior/core');
const now=new Date('2026-11-02T12:00:00Z');let n=0;
const event=(kind,minutes,data={},extra={})=>({eventId:'e'+(++n),kind,environment:'demo',visitorId:'v1',sessionId:'s1',timestamp:new Date(+now-minutes*60000),data,...extra});
const cart=(version,extra={})=>({cartId:'c1',version,currency:'USD',value:20,itemCount:1,...extra});
test('active → cart abandoned → checkout abandoned → recovered',()=>{
 const add=event('cart_updated',10,cart(1));assert.equal(analyze([add],{now,abandonMinutes:30}).carts[0].status,'active');
 assert.equal(analyze([add],{now,abandonMinutes:1}).carts[0].status,'cart_abandoned');
 const checkout=event('checkout_started',9,cart(2));assert.equal(analyze([checkout,add],{now,abandonMinutes:1}).carts[0].status,'checkout_abandoned');
 const purchase=event('purchase_completed',0,cart(3,{orderId:'o1'}));const r=analyze([purchase,checkout,add,purchase],{now,abandonMinutes:1});assert.equal(r.summary.recovered,1);assert.equal(r.summary.abandoned,0);assert.equal(r.actors[0].purchases,1);
});
test('empty carts excluded; active carts excluded from denominator; currencies not summed',()=>{
 const events=[event('cart_updated',5,cart(1)),event('cart_updated',0,cart(2,{itemCount:0,value:0})),event('cart_updated',0,cart(1,{cartId:'c2'})),event('cart_updated',5,cart(1,{cartId:'c3',currency:'EUR'}))];const r=analyze(events,{now,abandonMinutes:1});assert.equal(r.summary.emptied,1);assert.equal(r.summary.active,1);assert.equal(r.summary.eligible,1);assert.equal(r.summary.abandonmentRate,100);assert.deepEqual(r.summary.abandonedValue,{EUR:20});
});
test('validation allowlists fields and protects project identity',()=>{
 const e=normalizeEvent(event('validation_failure',0,{element:'checkout-card',code:'invalid',value:'4111111111111111',stack:'secret'},{projectId:'evil'}),'good',now);assert.equal(e.projectId,'good');assert.deepEqual(e.data,{element:'checkout-card',code:'invalid'});assert.throws(()=>normalizeEvent(event('purchase_completed',0,cart(1)),'p',now));assert.throws(()=>normalizeEvent(event('cart_updated',-10,cart(1)),'p',now));
});
test('rolling editable rules and anonymous/known identities',()=>{
 const events=[event('product_view',1),event('product_view',2),event('product_view',3),event('product_view',4,{}, {userId:'u1'})];const rule={windowDays:7,conditions:[{metric:'productViews',op:'gte',value:3},{metric:'purchases',op:'eq',value:0}]};const matches=membersFor(events,rule,{now});assert.equal(matches.length,1);assert.equal(matches[0].key,'visitor:v1');assert.throws(()=>validateRule({windowDays:0,conditions:[]}));assert.throws(()=>validateRule({windowDays:1,conditions:[{metric:'secret',op:'gte',value:1}]}));
});
test('friction occurrences deduplicate event IDs and aggregate sessions',()=>{const a=event('repeated_click',1,{element:'buy',count:4},{path:'/cart'});const b=event('repeated_click',0,{element:'buy',count:4},{path:'/cart',sessionId:'s2'});const r=analyze([a,a,b],{now});assert.equal(r.issues.length,1);assert.equal(r.issues[0].count,2);assert.equal(r.issues[0].affectedActors,1);assert.equal(r.issues[0].sessions.length,2);});
test('tied clocks use cart versions; stale snapshots and duplicate orders cannot reopen a purchase',()=>{
 const add=event('cart_updated',1,cart(1));const pay=event('purchase_completed',1,cart(2,{orderId:'same-order'}));const stale=event('cart_updated',0,cart(1));const duplicate=event('purchase_completed',0,cart(3,{cartId:'duplicate-cart',orderId:'same-order'}));
 const r=analyze([duplicate,pay,stale,add],{now,abandonMinutes:30});assert.equal(r.summary.purchased,1);assert.equal(r.summary.carts,1);assert.equal(r.actors[0].purchases,1);assert.equal(r.actors[0].revenue.USD,20);
});
test('high-intent membership expires as an active cart becomes abandoned',()=>{
 const rule={windowDays:7,conditions:[{metric:'activeCarts',op:'gte',value:1},{metric:'purchases',op:'eq',value:0}]};const events=[event('cart_updated',2,cart(1))];
 assert.equal(membersFor(events,rule,{now,abandonMinutes:30}).length,1);assert.equal(membersFor(events,rule,{now,abandonMinutes:1}).length,0);
 assert.throws(()=>validateRule({windowDays:7,conditions:[null]}),{status:400});
});
