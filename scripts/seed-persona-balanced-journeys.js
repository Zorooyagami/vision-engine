#!/usr/bin/env node
'use strict';
/** Synthetic-only, additive persona balancing. Read-only unless --apply. */
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const DAY=86400000;
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const frac=s=>parseInt(hash(s).slice(0,8),16)/0xffffffff;
const round=n=>Math.round(n*100)/100;
const LOC=[
 {country:'India',countryCode:'IN',city:'Mumbai',region:'Maharashtra',timezone:'Asia/Kolkata'},
 {country:'India',countryCode:'IN',city:'Delhi',region:'Delhi',timezone:'Asia/Kolkata'},
 {country:'India',countryCode:'IN',city:'Bengaluru',region:'Karnataka',timezone:'Asia/Kolkata'},
 {country:'India',countryCode:'IN',city:'Pune',region:'Maharashtra',timezone:'Asia/Kolkata'},
 {country:'United Kingdom',countryCode:'GB',city:'London',region:'England',timezone:'Europe/London'},
 {country:'United States',countryCode:'US',city:'New York',region:'New York',timezone:'America/New_York'},
 {country:'Singapore',countryCode:'SG',city:'Singapore',region:'Singapore',timezone:'Asia/Singapore'},
 {country:'United Arab Emirates',countryCode:'AE',city:'Dubai',region:'Dubai',timezone:'Asia/Dubai'}
];
function args(argv){
 const a={project:'vis_6bcd1aef732e0d5d',batch:'devday_persona_balance_v3',baseBatch:'devday_catalog_v2',firsttime:30,active:30,days:180,apply:false,verify:false,cleanup:false};
 for(let i=0;i<argv.length;i++){
  const t=argv[i];if(['--apply','--verify','--cleanup'].includes(t)){a[t.slice(2)]=true;continue;}
  const k=t.slice(2).replace(/-([a-z])/g,(_,v)=>v.toUpperCase());
  if(!t.startsWith('--')||!['project','batch','baseBatch','firsttime','active','days','asOf','catalog','mongoUri','confirmBatch'].includes(k))throw Error('Unknown flag '+t);
  if(argv[i+1]===undefined)throw Error('Missing '+t);a[k]=argv[++i];
 }
 for(const k of ['days','firsttime','active']){a[k]=Number(a[k]);if(!Number.isSafeInteger(a[k])||a[k]<(k==='days'?30:0)||a[k]>(k==='days'?366:150))throw Error('Invalid '+k)}
 if(!/^[A-Za-z0-9_-]{3,64}$/.test(a.batch)||a.batch===a.baseBatch)throw Error('Invalid batch name');
 if(a.cleanup&&(!a.apply||a.confirmBatch!==a.batch))throw Error('Cleanup requires --cleanup --apply --confirm-batch '+a.batch);
 if(!a.cleanup&&!a.verify&&(!a.asOf||!Number.isFinite(Date.parse(a.asOf))||new Date(a.asOf)>new Date()))throw Error('Supply a past --as-of ISO timestamp');
 return a;
}
function catalog(file){
 const source=fs.readFileSync(path.resolve(file),'utf8');
 let raw;
 if(file.endsWith('.json'))raw=JSON.parse(source);
 else{const m=source.match(/(?:export\s+)?const\s+products\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);if(!m)throw Error('Expected export const products = [...]');raw=JSON.parse(m[1])}
 if(!Array.isArray(raw))throw Error('Expected product array');
 const items=raw.filter(p=>p&&p.id!=null&&p.name&&Number(p.price)>0).map(p=>({...p,price:Number(p.price)}));
 if(items.length<20||new Set(items.map(p=>String(p.id))).size!==items.length)throw Error('Invalid or duplicate product IDs');
 return items;
}
// First three cases: today, within a week, within a month. Remaining cases: evenly span the whole reporting horizon.
function ageDays(i,count,days,seed){
 if(i===0)return .28; if(i===1)return .53;if(i===2)return 3.2;
 if(i===3)return 6.2;if(i===4)return 15.3;if(i===5)return 27.5;
 const rest=Math.max(1,count-6);
 return Math.min(days-3,30+(days-32)*(i-6+.2+.3*frac(seed+'|'+i))/Math.max(1,rest-1));
}
function makeDocs(o,products){
 const end=new Date(o.asOf).getTime(),start=end-o.days*DAY,docs=[],counts={firsttime:{users:0,purchases:0,revenue:0},active:{users:0,purchases:0,revenue:0}},monthly={};
 function emit(userId,sessionId,type,at,props,geo,device,scenario,idx,pathName){
  const stamp=new Date(at),url='https://dev-day-ecom.web.app'+pathName;
  docs.push({_id:hash(`${o.project}|${o.batch}|${sessionId}|${idx}|${type}`).slice(0,24),projectId:o.project,seedBatchId:o.batch,isSynthetic:true,seedScenario:scenario,event:type,userId,sessionId,timestamp:stamp,url,path:pathName,referrer:'https://dev-day-ecom.web.app/',trafficSource:idx%3===0?'organic':'direct',deviceInfo:{deviceType:device,os:device==='Mobile'?'Android':'Windows',browser:'Chrome',platform:device==='Mobile'?'Linux armv8':'Win32',timezone:geo.timezone,geo:{...geo,timezone:{id:geo.timezone}}},properties:props});
 }
 function session(userId,persona,userIndex,at,cycle,mode){
  const sid='vpb_'+hash(`${o.batch}|${persona}|${userIndex}|${cycle}`).slice(0,20),geo=LOC[(userIndex*3+cycle)%LOC.length],device=(userIndex+cycle)%4===0?'Mobile':'Desktop';
  const p=products[(userIndex*7+cycle*3+(persona==='active'?37:13))%products.length],cartId='cart_'+hash(sid).slice(0,16);
  let seq=0,time=at;
  const put=(name,props,route)=>{time+=12000+Math.round(frac(sid+'|'+seq)*8000);emit(userId,sid,name,time,props,geo,device,persona,seq++,route)};
  const identity={productId:p.id,name:p.name,category:p.category,subCategory:p.subCategory,brand:p.brand,price:p.price};
  const item={id:p.id,name:p.name,price:p.price,quantity:1,brand:p.brand,category:p.category,subCategory:p.subCategory};
  put('page_view',{title:'ShopEasy - Ecommerce',path:'/products'},'/products');
  put('view_item_list',{title:'ShopEasy - Ecommerce',totalItems:products.length,items:[item]},'/products');
  if(cycle%3===0)put('search_performed',{searchQuery:p.category,resultsCount:5},'/products');
  put('select_item',{...identity,position:2},'/products');
  put('product_view',{productId:p.id,name:p.name,category:p.category,subCategory:p.subCategory,brand:p.brand},'/products-detail/'+p.id);
  if(mode==='browse')return;
  if(mode==='stock') {put('product_stock_unavailable',{productId:p.id,name:p.name,requestedQuantity:2,availableQuantity:0},'/products-detail/'+p.id);return}
  put('add_to_cart',{...identity,cartId,quantity:1,source:'product_page'},'/products-detail/'+p.id);
  put('view_cart',{title:'ShopEasy - Ecommerce',cartId,products:[item],totalPrice:p.price,totalItems:1},'/cart');
  if(mode==='remove'){put('remove_from_cart',{productId:p.id,cartId,quantity:1,price:p.price},'/cart');return}
  put('checkout_start',{title:'ShopEasy - Ecommerce',cartId,products:[item],totalPrice:p.price,totalItems:1},'/cart');
  if(mode==='payment_failed'){put('shipping_details',{title:'ShopEasy - Ecommerce',cartId,products:[item],totalPrice:p.price,totalItems:1},'/shipping-info');put('payment_failed',{cartId,paymentMethod:'card',reasonCode:'PAYMENT_DECLINED'},'/payment');return}
  if(mode==='checkout_error'){put('checkout_step_error',{cartId,step:'shipping',errorCode:'VALIDATION_FAILED'},'/shipping-info');return}
  put('shipping_details',{title:'ShopEasy - Ecommerce',cartId,products:[item],totalPrice:p.price,totalItems:1},'/shipping-info');
  put('purchase',{title:'ShopEasy - Ecommerce',orderId:'DEMO-'+hash(sid+'order').slice(0,18),cartId,total:p.price.toFixed(2),currency:'USD',paymentMethod:'card',products:[{productId:p.id,productName:p.name,productPrice:p.price,productQuantity:1}]},'/payment');
  counts[persona].purchases++;counts[persona].revenue=round(counts[persona].revenue+p.price);
  const month=new Date(time).toISOString().slice(0,7);monthly[month]??={};monthly[month][persona]=(monthly[month][persona]||0)+p.price;
 }
 for(const persona of ['firsttime','active']){
  const n=o[persona];
  for(let i=0;i<n;i++){
   const userId=`vb_${hash(`${o.project}|${o.batch}|${persona}|${i}`).slice(0,19)}`;
   const age=ageDays(i,n,o.days,o.batch+persona)+(persona==='active'?.11:0),when=end-age*DAY;
   if(when<start||when>end-DAY*.1)throw Error('Unexpected event timestamp');
   const g=LOC[i%LOC.length];
   // Active customers joined *before* the reporting window, so they remain Active at every window.
   // First-time users sign up shortly before their first buying journey, so they retain First-time membership.
   const signupAt=persona==='active'?start-12*DAY-i*60000:when-3600000;
   emit(userId,'vpb_signup_'+hash(userId).slice(0,16),'sign_up',signupAt,{title:'ShopEasy - Ecommerce'},g,'Desktop',persona,0,'/sign-up');
   counts[persona].users++;
   // Repeat the non-buying journey in a separate session; preserve 1 lifetime purchase max.
   const prior=Math.max(start+3600000,when-Math.min(14,age*.3)*DAY);
   if(prior<when-3600000)session(userId,persona,i,prior,0,i%4===0?'stock':i%4===1?'payment_failed':i%4===2?'checkout_error':'remove');
   session(userId,persona,i,when,1,i%6===0?'remove':'purchase');
  }
 }
 const byEvent={};for(const d of docs)byEvent[d.event]=(byEvent[d.event]||0)+1;
 return {docs,summary:{batch:o.batch,project:o.project,period:{from:new Date(start).toISOString(),to:new Date(end).toISOString()},newSyntheticUsers:{firsttime:counts.firsttime.users,active:counts.active.users},purchases:{firsttime:counts.firsttime.purchases,active:counts.active.purchases},revenue:{firsttime:counts.firsttime.revenue,active:counts.active.revenue},purchasesByMonth:monthly,eventTypes:byEvent,totalEvents:docs.length,existingDataUnchanged:true}};
}
async function main(){
 const o=args(process.argv.slice(2));const mongoose=require('mongoose');
 const uri= 'mongodb+srv://zorooyagami_db_user:CIkhZNwzcx2Xpfu1@vision-engine.e8foaez.mongodb.net/vision?appName=vision-engine'//o.mongoUri||process.env.MONGO_URI||process.env.MONGODB_URI;
 if(!uri)throw Error('Set MONGO_URI / MONGODB_URI');
 const file=o.catalog||path.join(__dirname,'products.js');
 try{
  await mongoose.connect(uri,{serverSelectionTimeoutMS:12000});const db=mongoose.connection.db,ev=db.collection('events');
  const selector={projectId:o.project,seedBatchId:o.batch,isSynthetic:true};
  if(o.cleanup){const x=await ev.deleteMany(selector);console.log(JSON.stringify({deleted:x.deletedCount,batch:o.batch}));return}
  if(o.verify){const rows=await ev.aggregate([{$match:selector},{$group:{_id:{scenario:'$seedScenario',event:'$event'},count:{$sum:1}}},{$sort:{'_id.scenario':1,'_id.event':1}}]).toArray();console.log(JSON.stringify({batch:o.batch,rows},null,2));return}
  const products=catalog(file);
  // Do not silently seed another project or an unexpected catalogue.
  const baseline=await ev.countDocuments({projectId:o.project,seedBatchId:o.baseBatch,isSynthetic:true},{limit:1});
  if(!baseline)throw Error(`Base batch ${o.baseBatch} not found; no writes`);
  const match=await ev.aggregate([{$match:{projectId:o.project,seedBatchId:o.baseBatch,event:'product_view'}},{$group:{_id:'$properties.productId',name:{$first:'$properties.name'}}},{$limit:300}]).toArray();
  const byId=new Map(products.map(p=>[String(p.id),p]));
  const verified=match.filter(p=>byId.has(String(p._id))&&(!p.name||String(byId.get(String(p._id)).name).toLowerCase()===String(p.name).toLowerCase()));
  if(verified.length<10)throw Error('Product catalogue does not match base seed IDs/names; no writes');
  const output=makeDocs(o,products);
  const existing=await ev.countDocuments(selector);
  if(existing>0 && o.apply)throw Error('Batch already exists. No writes; use --verify or a NEW --batch for another run.');
  console.log(JSON.stringify({mode:o.apply?'APPLY':'DRY_RUN',catalogueSource:path.resolve(file),catalogueProducts:products.length,verifiedBaseProducts:verified.length,existingBatchEvents:existing,...output.summary},null,2));
  if(!o.apply){console.log('DRY RUN: zero database writes.');return}
  const ObjectId=mongoose.Types.ObjectId;
  let inserted=0;
  for(let i=0;i<output.docs.length;i+=250){
   const ops=output.docs.slice(i,i+250).map(({_id,...e})=>({updateOne:{filter:{_id:new ObjectId(_id)},update:{$setOnInsert:{_id:new ObjectId(_id),...e}},upsert:true}}));
   const r=await ev.bulkWrite(ops,{ordered:false});inserted+=r.upsertedCount;
  }
  console.log(JSON.stringify({inserted,batch:o.batch,expected:output.docs.length},null,2));
 }finally{await mongoose.disconnect().catch(()=>{})}
}
if(require.main===module)main().catch(e=>{console.error('Seeder failed:',e.message);process.exitCode=1});
module.exports={args,catalog,makeDocs,ageDays};
