'use strict';
const Event = require('../models/Event');
const OpportunityStatus = require('../models/OpportunityStatus');
const VALID_EVENTS = ['page_view','product_view','add_to_cart','remove_from_cart','purchase','view_cart','checkout_start','shipping_details','checkout_step_error','payment_failed','product_stock_unavailable','search_performed','search_result_click'];
const CACHE_MS = 45000;
const cache = new Map();
const inflight = new Map();
const periods = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '180d': 180, '6m': 183 };
function dateWindow(query, now = new Date()) {
  if (query.period === 'custom') {
    const from = new Date(query.from), to = new Date(query.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from || to > now || to-from > 366*864e5) {
      const error = new Error('Invalid custom date window'); error.status = 400; throw error;
    }
    return { start: from, end: to };
  }
  const days = periods[query.period || '30d'];
  if (!days) { const error = new Error('Unsupported period'); error.status = 400; throw error; }
  return { start: new Date(now - days*864e5), end: now };
}
function periodDays(start, end) { return Math.max(1,(end-start)/864e5); }
function round(n, d=1) {return Number(Number(n||0).toFixed(d));}
function recommend(id, category, title, observation, action, score, confidence, evidence, link) {
  return {key:`di:${id}`,category,title,observation,action,priority:score>=75?'high':score>=45?'medium':'low',score,confidence,evidence,link};
}
function createRecommendations({ counts, products, devices, searches, breakdowns = {}, days }) {
  const result = [];
  const c = Object.fromEntries(counts.map(x=>[x._id,x]));
  const count = name => c[name]?.count || 0;
  const sessionCount = name => c[name]?.sessions?.length || 0;
  const purchases = count('purchase');
  const cart = sessionCount('add_to_cart');
  const checkout = sessionCount('checkout_start');
  if(cart >= 15 && checkout/cart < .85) result.push(recommend('cart-progression','Checkout','Investigate cart-to-checkout progression',`${cart} sessions added a product to cart; ${checkout} sessions began checkout. These are not necessarily the same sessions.`, 'Review cart UX and inspect matching journeys before claiming abandonment.',77,cart>=50?'moderate':'exploratory',{cartSessions:cart,checkoutSessions:checkout},'/explore/funnels'));
  const fails = count('payment_failed'), errors=count('checkout_step_error');
  if(fails>=3) result.push(recommend('payment-failures','Payments','Review payment failure patterns',`${fails} payment failure events were recorded during this period.`, 'Group failures by payment method and reason code; check whether affected sessions subsequently purchased.',Math.min(90,55+Math.floor(fails/6)),fails>=20?'moderate':'exploratory',{paymentFailures:fails},'/revenue/investigator'));
  if(errors>=3) result.push(recommend('checkout-errors','Checkout','Review checkout step errors',`${errors} checkout step errors were recorded.`, 'Identify the most frequently affected step and validate with replay where available.',Math.min(85,50+Math.floor(errors/5)),errors>=20?'moderate':'exploratory',{checkoutErrors:errors},'/explore/funnels'));
  const stock=count('product_stock_unavailable');
  if(stock>=3) result.push(recommend('stock-issues','Inventory','Investigate unavailable product demand',`${stock} requests encountered unavailable stock.`, 'Compare affected product IDs with catalogue stock and recent sales.',Math.min(85,48+Math.floor(stock/6)),stock>=20?'moderate':'exploratory',{stockUnavailable:stock},'/revenue/opportunity-radar'));
  const byProduct = new Map();
  for(const x of products) { const key=String(x._id?.id??''); if (!key || key==='null') continue; const row=byProduct.get(key)||{id:key,name:x.name||`Product ${key}`,views:0,adds:0,removes:0,purchases:0}; row[x._id.event==='product_view'?'views':x._id.event==='add_to_cart'?'adds':x._id.event==='remove_from_cart'?'removes':'purchases']+=x.count; if(x.name && row.name.startsWith('Product ')) row.name=x.name; byProduct.set(key,row); }
  const highInterest=[...byProduct.values()].filter(x=>x.views>=8 && x.purchases<=1).sort((a,b)=>b.views-a.views)[0];
  if(highInterest) result.push(recommend(`product-${highInterest.id}`,'Products',`Review product interest: ${highInterest.name}`,`${highInterest.views} product views and ${highInterest.purchases} itemized purchases were recorded.`, 'Investigate product price, detail quality and availability; event counts are not unique visitors.',Math.min(82,45+Math.floor(highInterest.views/5)),highInterest.views>=25?'moderate':'exploratory',highInterest,'/revenue/opportunity-radar'));
  const removed=[...byProduct.values()].filter(x=>x.adds>=5&&x.removes>=3&&x.removes/x.adds>=.3).sort((a,b)=>(b.removes/b.adds)-(a.removes/a.adds))[0];
  if(removed) result.push(recommend(`removal-${removed.id}`,'Cart',`Investigate cart removals: ${removed.name}`,`${removed.removes} removals compared with ${removed.adds} add-to-cart events.`, 'Review price expectations and product details. Events are not confirmed unique carts.',65,removed.adds>=20?'moderate':'exploratory',removed,'/revenue/opportunity-radar'));
  const mobile=devices.find(x=>x._id==='Mobile'), desktop=devices.find(x=>x._id==='Desktop');
  if(mobile?.sessions?.length>=15 && desktop?.sessions?.length>=15) {
    const mobileRate=(mobile.buyingSessions?.length||0)/mobile.sessions.length;
    const desktopRate=(desktop.buyingSessions?.length||0)/desktop.sessions.length;
    if(mobileRate + .03 < desktopRate) result.push(recommend('mobile-gap','Devices','Investigate mobile purchasing progression',`Purchase-session share: mobile ${round(100*mobileRate)}%, desktop ${round(100*desktopRate)}%.`, 'Compare checkout steps by device; session-level differences do not prove device-related causation.',70,'moderate',{mobileSessions:mobile.sessions.length,desktopSessions:desktop.sessions.length,mobileRate:round(mobileRate*100),desktopRate:round(desktopRate*100)},'/explore/funnels'));
  }
  const zero=searches.filter(x=>x._id==='zero').reduce((n,x)=>n+x.count,0), total=searches.reduce((n,x)=>n+x.count,0);
  if(total>=10&&zero>=3) result.push(recommend('zero-search','Search','Improve searches returning no results',`${zero} of ${total} recorded searches returned zero results.`, 'Review popular zero-result search terms and synonyms.',55,'moderate',{zeroResultSearches:zero,totalSearches:total},'/explore'));
  const toRows=(source)=> (source||[]).map(x=>({label:String(x._id||'Not specified'),count:x.count})).slice(0,8);
  for (const r of result) {
    if(r.key==='di:payment-failures') r.details={paymentMethods:toRows(breakdowns.paymentMethods),failureReasons:toRows(breakdowns.failureReasons)};
    if(r.key==='di:checkout-errors') r.details={checkoutSteps:toRows(breakdowns.checkoutSteps),checkoutErrorCodes:toRows(breakdowns.checkoutErrorCodes)};
    if(r.key==='di:stock-issues') {
      const names=new Map([...byProduct.values()].filter(p=>p.name&&!p.name.startsWith('Product ')).map(p=>[String(p.id),p.name]));
      r.details={stockProducts:toRows(breakdowns.stockProducts).map(row=>({...row,productId:row.label,label:names.has(String(row.label))?`${names.get(String(row.label))} (#${row.label})`:`Product #${row.label}`}))};
    }
    if(r.key==='di:zero-search') r.details={searchQueries:toRows(breakdowns.searchQueries)};
  }
  return result.sort((a,b)=>b.score-a.score).slice(0,12);
}
async function readDatabase(projectId, start, end) {
 const match = {projectId, timestamp:{$gte:start,$lte:end},event:{$in:VALID_EVENTS}};
 const [data] = await Event.aggregate([
   {$match:match},
   {$project:{event:1,userId:1,sessionId:1,timestamp:1,'properties.productId':1,'properties.id':1,'properties.name':1,'properties.products.productId':1,'properties.products.productName':1,'properties.resultsCount':1,'properties.paymentMethod':1,'properties.reasonCode':1,'properties.step':1,'properties.errorCode':1,'properties.searchQuery':1,'deviceInfo.deviceType':1,isSynthetic:1}},
   {$facet:{
     counts:[{$group:{_id:'$event',count:{$sum:1},sessions:{$addToSet:'$sessionId'}}}],
     products:[{$match:{event:{$in:['product_view','add_to_cart','remove_from_cart','purchase']}}},{$project:{event:1,items:{$cond:[{$eq:['$event','purchase']},{$map:{input:{$ifNull:['$properties.products',[]]},as:'p',in:{id:'$$p.productId',name:'$$p.productName'}}},[{id:{$ifNull:['$properties.productId','$properties.id']},name:'$properties.name'}]]}}},{$unwind:'$items'},{$match:{'items.id':{$ne:null}}},{$group:{_id:{event:'$event',id:'$items.id'},count:{$sum:1},name:{$first:'$items.name'}}},{$sort:{count:-1}},{$limit:600}],
     devices:[{$match:{event:{$in:['page_view','product_view','purchase','add_to_cart']}}},{$group:{_id:'$deviceInfo.deviceType',sessions:{$addToSet:'$sessionId'},buyingSessions:{$addToSet:{$cond:[{$eq:['$event','purchase']},'$sessionId',null]}}}}],
     searches:[{$match:{event:'search_performed'}},{$group:{_id:{$cond:[{$eq:['$properties.resultsCount',0]},'zero','other']},count:{$sum:1}}}],
     synthetic:[{$group:{_id:null,total:{$sum:1},synthetic:{$sum:{$cond:[{$eq:['$isSynthetic',true]},1,0]}}}}],
     paymentMethods:[{$match:{event:'payment_failed'}},{$group:{_id:{$ifNull:['$properties.paymentMethod','Not specified']},count:{$sum:1}}},{$sort:{count:-1}},{$limit:8}],
     failureReasons:[{$match:{event:'payment_failed'}},{$group:{_id:{$ifNull:['$properties.reasonCode','Not specified']},count:{$sum:1}}},{$sort:{count:-1}},{$limit:8}],
     checkoutSteps:[{$match:{event:'checkout_step_error'}},{$group:{_id:{$ifNull:['$properties.step','Not specified']},count:{$sum:1}}},{$sort:{count:-1}},{$limit:8}],
     checkoutErrorCodes:[{$match:{event:'checkout_step_error'}},{$group:{_id:{$ifNull:['$properties.errorCode','Not specified']},count:{$sum:1}}},{$sort:{count:-1}},{$limit:8}],
     stockProducts:[{$match:{event:'product_stock_unavailable'}},{$group:{_id:{$ifNull:['$properties.productId','Not specified']},count:{$sum:1}}},{$sort:{count:-1}},{$limit:8}],
     searchQueries:[{$match:{event:'search_performed','properties.resultsCount':0}},{$group:{_id:{$ifNull:['$properties.searchQuery','Not specified']},count:{$sum:1}}},{$sort:{count:-1}},{$limit:8}]
   }}
 ]).allowDiskUse(true).option({maxTimeMS:12000});
 for(const d of data.devices||[]) d.buyingSessions=d.buyingSessions.filter(Boolean);
 return data;
}
async function loadIntelligence(projectId, query={}) {
 const {start,end}=dateWindow(query), key=`${projectId}|${start.toISOString().slice(0,16)}|${end.toISOString().slice(0,16)}`;
 const existing=cache.get(key); if(existing && Date.now()-existing.time<CACHE_MS)return existing.data;
 if(inflight.has(key))return inflight.get(key);
 const pending=(async()=>{
   const data=await readDatabase(projectId,start,end);
   const recommendations=createRecommendations({...data,breakdowns:{paymentMethods:data.paymentMethods,failureReasons:data.failureReasons,checkoutSteps:data.checkoutSteps,checkoutErrorCodes:data.checkoutErrorCodes,stockProducts:data.stockProducts,searchQueries:data.searchQueries},days:periodDays(start,end)});
   const statuses=await OpportunityStatus.find({projectId,opportunityKey:{$in:recommendations.map(r=>r.key)}}).select('opportunityKey status note updatedAt').lean();
   const statusMap=new Map(statuses.map(s=>[s.opportunityKey,s]));
   const result={period:query.period||'30d',from:start.toISOString(),to:end.toISOString(),sample:{events:data.synthetic[0]?.total||0,syntheticEvents:data.synthetic[0]?.synthetic||0},summary:{opportunities:recommendations.length,highPriority:recommendations.filter(r=>r.priority==='high').length,underReview:statuses.filter(s=>['investigating','in_progress','planned'].includes(s.status)).length},recommendations:recommendations.map(r=>({...r,status:statusMap.get(r.key)?.status||'new',note:statusMap.get(r.key)?.note||''}))};
   cache.set(key,{time:Date.now(),data:result});if(cache.size>100) cache.delete(cache.keys().next().value);
   return result;
 })();inflight.set(key,pending);try{return await pending;}finally{inflight.delete(key);}
}
function invalidate(projectId){for(const key of cache.keys())if(key.startsWith(`${projectId}|`))cache.delete(key);}
module.exports={loadIntelligence,invalidate,dateWindow,createRecommendations};
