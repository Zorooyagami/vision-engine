'use strict';
const KINDS = ['page_view','product_view','cart_updated','checkout_started','purchase_completed','repeated_click','javascript_error','validation_failure','action_failure'];
const METRICS = ['sessions','productViews','purchases','cartAbandonments','checkoutAbandonments','activeCarts','friction'];
function invalid(message, status=400) { return Object.assign(new Error(message),{status}); }
function str(v,max=100) { return typeof v==='string'?v.slice(0,max):''; }
function id(v) { return typeof v==='string' && /^[a-zA-Z0-9_:.@-]{1,160}$/.test(v) ? v : ''; }
function normalizeEvent(input,projectId,now=new Date()) {
 if(!input || !KINDS.includes(input.kind) || !id(input.eventId) || !id(input.sessionId) || !id(input.visitorId)) throw invalid('Invalid behavior event identity or kind');
 if(!['demo','production'].includes(input.environment))throw invalid('Specify demo or production environment');
 const timestamp=new Date(input.timestamp);
 if(!Number.isFinite(+timestamp)||+timestamp>+now+60000||+timestamp<+now-90*86400000)throw invalid('Event timestamp outside accepted 90-day window');
 const d=input.data||{},data={};
 if(['cart_updated','checkout_started','purchase_completed'].includes(input.kind)) {
   if(!id(d.cartId))throw invalid('cartId required');data.cartId=d.cartId;
   if(!Number.isSafeInteger(d.version)||d.version<1)throw invalid('Positive cart version required');data.version=d.version;
   if(!/^[A-Z]{3}$/.test(d.currency||''))throw invalid('ISO currency required');data.currency=d.currency;
   if(!Number.isFinite(d.value)||d.value<0||d.value>1e9)throw invalid('Invalid cart value');data.value=Math.round(d.value*100)/100;
   if(!Number.isSafeInteger(d.itemCount)||d.itemCount<0||d.itemCount>100000)throw invalid('Invalid item count');data.itemCount=d.itemCount;
   if(input.kind==='purchase_completed'){if(!id(d.orderId)||d.itemCount===0)throw invalid('Order identity and items required');data.orderId=d.orderId;}
 }
 if(input.kind==='product_view')data.productId=str(d.productId||d.id,100);
 if(['repeated_click','javascript_error','validation_failure','action_failure'].includes(input.kind)) {
   // Explicit allowlist: never retain entered values, raw error messages or stacks.
   data.element=str(d.element,100).replace(/[^a-zA-Z0-9_.:#\[\] -]/g,'');
   data.code=str(d.code,80).replace(/[^a-zA-Z0-9_.:-]/g,'');
   if(Number.isSafeInteger(d.count))data.count=Math.min(100,d.count);
 }
 return {projectId,eventId:input.eventId,kind:input.kind,environment:input.environment,visitorId:input.visitorId,userId:id(input.userId)||null,sessionId:input.sessionId,timestamp,receivedAt:now,path:str(input.path,300).split(/[?#]/)[0],device:['Desktop','Mobile','Tablet'].includes(input.device)?input.device:'Unknown',data};
}
function validateRule(rule) {
 if(!rule || !Number.isInteger(rule.windowDays)||rule.windowDays<1||rule.windowDays>90 || !Array.isArray(rule.conditions)||!rule.conditions.length||rule.conditions.length>6)throw invalid('Rules need a 1–90 day window and 1–6 conditions');
 return {windowDays:rule.windowDays,conditions:rule.conditions.map(c=>{
   if(!c || !METRICS.includes(c.metric)||!['gte','lte','eq'].includes(c.op)||!Number.isSafeInteger(c.value)||c.value<0||c.value>100000)throw invalid('Invalid persona condition');
   return {metric:c.metric,op:c.op,value:c.value};
 })};
}
function actorKey(e){return e.userId?'user:'+e.userId:'visitor:'+e.visitorId;}
function analyze(events,{now=new Date(),abandonMinutes=30}={}) {
 const seen=new Set(),actors=new Map(),carts=new Map(),issues=new Map(),orders=new Set();
 const sorted=events.filter(e=>+new Date(e.timestamp)<=+now).sort((a,b)=>+new Date(a.timestamp)-+new Date(b.timestamp)||((a.data?.cartId&&a.data.cartId===b.data?.cartId)?a.data.version-b.data.version:0)||String(a.eventId).localeCompare(String(b.eventId)));
 for(const e of sorted) {
  if(seen.has(e.eventId))continue;seen.add(e.eventId);
  const key=actorKey(e),d=e.data||{},t=+new Date(e.timestamp);
  if(!actors.has(key))actors.set(key,{key,userId:e.userId||null,visitorId:e.visitorId,sessions:new Set(),productViews:0,purchases:0,cartAbandonments:0,checkoutAbandonments:0,activeCarts:0,friction:0,revenue:{}});
  const actor=actors.get(key);actor.sessions.add(e.sessionId);
  if(e.kind==='product_view')actor.productViews++;
  if(e.kind==='purchase_completed'&&orders.has(d.orderId))continue;
  if(['cart_updated','checkout_started','purchase_completed'].includes(e.kind)) {
   let cart=carts.get(d.cartId);
   if(!cart){cart={cartId:d.cartId,key,sessionId:e.sessionId,openedAt:t,lastActivity:t,version:0,itemCount:0,value:0,currency:d.currency,checkoutStartedAt:null,purchasedAt:null,recovered:false,everAbandoned:false};carts.set(d.cartId,cart);}
   // Cart versions establish order even when retries arrive out of order or clocks tie.
   if(d.version<=cart.version || cart.purchasedAt)continue;
   const idle=cart.itemCount>0&&t-cart.lastActivity>=abandonMinutes*60000;
   if(idle)cart.everAbandoned=true;
   cart.key=key;cart.sessionId=e.sessionId;cart.version=d.version;cart.lastActivity=Math.max(cart.lastActivity,t);cart.value=d.value;cart.currency=d.currency;cart.itemCount=d.itemCount;
   if(e.kind==='checkout_started')cart.checkoutStartedAt=cart.checkoutStartedAt||t;
   if(!d.itemCount)cart.checkoutStartedAt=null;
   if(e.kind==='purchase_completed') {
    cart.purchasedAt=t;cart.recovered=cart.everAbandoned;
    if(!orders.has(d.orderId)){orders.add(d.orderId);actor.purchases++;actor.revenue[d.currency]=(actor.revenue[d.currency]||0)+d.value;}
   }
  }
  if(['repeated_click','javascript_error','validation_failure','action_failure'].includes(e.kind)) {
   actor.friction++;
   const group=JSON.stringify([e.kind,e.path,d.element||'',d.code||'']);
   if(!issues.has(group))issues.set(group,{id:group,kind:e.kind,path:e.path,element:d.element||'',code:d.code||'',count:0,actors:new Set(),sessions:new Map(),lastSeen:e.timestamp});
   const issue=issues.get(group);issue.count++;issue.actors.add(key);issue.lastSeen=e.timestamp;
   issue.sessions.set(e.sessionId,{sessionId:e.sessionId,timestamp:e.timestamp,actor:key});
  }
 }
 for(const cart of carts.values()) {
  cart.status=cart.purchasedAt?(cart.recovered?'recovered':'purchased'):!cart.itemCount?'emptied':+now-cart.lastActivity>=abandonMinutes*60000?(cart.checkoutStartedAt?'checkout_abandoned':'cart_abandoned'):'active';
  if(cart.status==='active')actors.get(cart.key).activeCarts++;
  if(cart.status.endsWith('abandoned')) {const actor=actors.get(cart.key);actor.cartAbandonments++;if(cart.checkoutStartedAt)actor.checkoutAbandonments++;}
 }
 const list=[...carts.values()],abandoned=list.filter(c=>c.status.endsWith('abandoned')),settled=list.filter(c=>c.purchasedAt||c.status.endsWith('abandoned'));
 const checkoutSettled=settled.filter(c=>c.checkoutStartedAt);
 const totals={};for(const c of abandoned)totals[c.currency]=(totals[c.currency]||0)+c.value;
 return {actors:[...actors.values()].map(a=>({...a,sessionIds:[...a.sessions],sessions:a.sessions.size})),carts:list.sort((a,b)=>b.lastActivity-a.lastActivity),issues:[...issues.values()].map(i=>({...i,affectedActors:i.actors.size,actors:undefined,sessions:[...i.sessions.values()].slice(-100).reverse()})).sort((a,b)=>b.count-a.count),summary:{carts:list.length,active:list.filter(c=>c.status==='active').length,abandoned:abandoned.length,checkoutAbandoned:abandoned.filter(c=>c.checkoutStartedAt).length,purchased:list.filter(c=>c.purchasedAt).length,recovered:list.filter(c=>c.recovered).length,emptied:list.filter(c=>c.status==='emptied').length,eligible:settled.length,abandonmentRate:settled.length?100*abandoned.length/settled.length:null,checkoutEligible:checkoutSettled.length,checkoutRate:checkoutSettled.length?100*abandoned.filter(c=>c.checkoutStartedAt).length/checkoutSettled.length:null,abandonedValue:totals}};
}
function membersFor(events,rule,options) {
 const valid=validateRule(rule),now=options.now||new Date(),start=+now-valid.windowDays*86400000;
 return analyze(events.filter(e=>+new Date(e.timestamp)>=start),options).actors.filter(a=>valid.conditions.every(c=>c.op==='gte'?a[c.metric]>=c.value:c.op==='lte'?a[c.metric]<=c.value:a[c.metric]===c.value));
}
const TEMPLATES=[
 {slug:'product-explorers',name:'Product explorers',rule:{windowDays:30,conditions:[{metric:'productViews',op:'gte',value:3},{metric:'purchases',op:'eq',value:0}]}},
 {slug:'high-intent',name:'High-intent shoppers',rule:{windowDays:7,conditions:[{metric:'activeCarts',op:'gte',value:1},{metric:'purchases',op:'eq',value:0}]}},
 {slug:'repeat-buyers',name:'Repeat buyers',rule:{windowDays:30,conditions:[{metric:'purchases',op:'gte',value:2}]}},
 {slug:'cart-abandoners',name:'Cart abandoners',rule:{windowDays:30,conditions:[{metric:'cartAbandonments',op:'gte',value:1}]}},
 {slug:'checkout-abandoners',name:'Checkout abandoners',rule:{windowDays:30,conditions:[{metric:'checkoutAbandonments',op:'gte',value:1}]}},
 {slug:'friction-affected',name:'Friction-affected visitors',rule:{windowDays:7,conditions:[{metric:'friction',op:'gte',value:2}]}},
];
module.exports={normalizeEvent,analyze,membersFor,validateRule,TEMPLATES,METRICS,invalid};
