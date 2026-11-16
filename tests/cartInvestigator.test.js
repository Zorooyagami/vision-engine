const test=require('node:test');const assert=require('node:assert/strict');
const {investigateCart}=require('../services/behavior/cartInvestigator');
const base=new Date('2026-11-16T10:00:00Z');
let n=0;const ev=(session,kind,minute,data={})=>({eventId:'e'+(++n),sessionId:session,visitorId:'v'+session,kind,timestamp:new Date(+base+minute*60000).toISOString(),path:'/cart',device:'Desktop',data});
test('no fabricated cases or counts',()=>{const r=investigateCart([]);assert.equal(r.counts.cartSessions,0);assert.equal(r.totalCases,0)});
test('requires positive cart activity and labels missing checkout carefully',()=>{const r=investigateCart([ev('a','page_view',0),ev('a','cart_updated',1,{cartId:'c',itemCount:1}),ev('a','validation_failure',2,{code:'native_validation'})],{now:new Date(+base+3600000)});assert.equal(r.counts.cartSessions,1);assert.equal(r.counts.frictionSessions,1);assert.equal(r.cases[0].status,'cart_no_checkout')});
test('checkout and purchase must match cart and session',()=>{const events=[ev('s','cart_updated',0,{cartId:'a',itemCount:2}),ev('s','checkout_started',1,{cartId:'a',itemCount:2}),ev('s','purchase_completed',2,{cartId:'b',itemCount:2}),ev('other','purchase_completed',3,{cartId:'a',itemCount:2})];const r=investigateCart(events,{now:new Date(+base+3600000)});assert.equal(r.cases[0].status,'checkout_no_purchase');assert.equal(r.counts.purchaseRecorded,0)});
test('duplicate eventIds do not double count timeline',()=>{const e=ev('s','cart_updated',1,{cartId:'a',itemCount:1});const r=investigateCart([e,e],{now:new Date(+base+3600000)});assert.equal(r.cases[0].timeline.length,1)});
test('purchase event recorded is not counted as payment verification',()=>{const r=investigateCart([ev('s','cart_updated',1,{cartId:'a',itemCount:1}),ev('s','purchase_completed',2,{cartId:'a',itemCount:1})],{now:new Date(+base+3600000)});assert.equal(r.counts.purchaseRecorded,1);assert.equal(r.cases[0].status,'purchase_recorded')});
const legacy=(session,event,minute,id)=>({_id:id,sessionId:session,event,timestamp:new Date(+base+minute*60000).toISOString(),path:'/cart',deviceInfo:{deviceType:'Mobile'}})
test('historical standard add_to_cart events become explicit analytics-only cases',()=>{
 const a=[legacy('old','add_to_cart',1,'l1'),legacy('old','checkout_start',2,'l2'),legacy('old','purchase',3,'l3')]
 const r=investigateCart([],{now:new Date(+base+3600000),analyticsEvents:a})
 assert.equal(r.totalCases,1);assert.equal(r.cases[0].source,'analytics');assert.equal(r.cases[0].cartId,null)
 assert.equal(r.counts.purchaseRecorded,1)
})
test('an old analytics session is not double counted when a matching behavior cart is present',()=>{
 const b=[ev('both','cart_updated',1,{cartId:'c1',itemCount:1})]
 const a=[legacy('both','add_to_cart',1,'l1')]
 const r=investigateCart(b,{now:new Date(+base+3600000),analyticsEvents:a})
 assert.equal(r.totalCases,1);assert.equal(r.counts.analyticsOnlySessions,0);assert.equal(r.diagnostics.overlappingSessions,1)
})
test('page views and checkout without add_to_cart do not create historical carts',()=>{
 const a=[legacy('onlyview','view_cart',1,'l1'),legacy('onlycheckout','checkout_start',2,'l2')]
 assert.equal(investigateCart([],{now:new Date(+base+3600000),analyticsEvents:a}).totalCases,0)
})
test('legacy event ordering requires checkout and purchase after recorded cart',()=>{
 const a=[legacy('s','purchase',1,'l1'),legacy('s','checkout_start',2,'l2'),legacy('s','add_to_cart',3,'l3')]
 const r=investigateCart([],{now:new Date(+base+3600000),analyticsEvents:a})
 assert.equal(r.counts.cartNoCheckout,1);assert.equal(r.counts.purchaseRecorded,0)
})
test('purchase sessions without cart history remain visible in total purchase coverage',()=>{
 const b=[ev('withoutCart','purchase_completed',1,{cartId:'unknown',orderId:'ORDER-A'}),ev('withCart','cart_updated',1,{cartId:'cart1',itemCount:1}),ev('withCart','purchase_completed',2,{cartId:'cart1',orderId:'ORDER-B'})]
 const a=[legacy('legacyPurchase','purchase',3,'legacy-purchase')]
 const r=investigateCart(b,{now:new Date(+base+3600000),analyticsEvents:a})
 assert.equal(r.counts.cartSessions,1)
 assert.equal(r.counts.purchaseRecorded,1)
 assert.equal(r.counts.allTrackedPurchaseSessions,3)
 assert.equal(r.counts.purchaseWithoutMatchedCart,2)
})
test('duplicate purchase reporting across behavior and analytics does not inflate unique purchase sessions',()=>{
 const b=[ev('same','cart_updated',1,{cartId:'c',itemCount:1}),ev('same','purchase_completed',2,{cartId:'c',orderId:'order-one'})]
 const a=[legacy('same','purchase',2,'l-purchase')]
 const r=investigateCart(b,{now:new Date(+base+3600000),analyticsEvents:a})
 assert.equal(r.counts.allTrackedPurchaseSessions,1)
 assert.equal(r.diagnostics.purchaseEventOccurrences,2)
 assert.equal(r.counts.purchaseWithoutMatchedCart,0)
})
test('paginated investigation navigates older sessions without changing totals',()=>{
 const a=Array.from({length:23},(_,i)=>legacy('sess'+i,'add_to_cart',i,'cart-'+i))
 const first=investigateCart([],{now:new Date(+base+3600000),analyticsEvents:a,limit:8,offset:0})
 const last=investigateCart([],{now:new Date(+base+3600000),analyticsEvents:a,limit:8,offset:16})
 assert.equal(first.counts.cartSessions,23)
 assert.equal(first.cases.length,8)
 assert.equal(last.cases.length,7)
 assert.equal(last.filteredCases,23)
 assert.notEqual(first.cases[0].sessionId,last.cases[0].sessionId)
})
test('status filter applies to all cases before pagination',()=>{
 const a=[legacy('b','add_to_cart',1,'c1'),legacy('p','add_to_cart',2,'c2'),legacy('p','purchase',3,'p1'),legacy('c','add_to_cart',4,'c3')]
 const r=investigateCart([],{now:new Date(+base+3600000),analyticsEvents:a,status:'purchase_recorded',limit:1})
 assert.equal(r.totalCases,3)
 assert.equal(r.filteredCases,1)
 assert.equal(r.cases[0].sessionId,'p')
 assert.equal(r.counts.purchaseEventOccurrences,1)
})
