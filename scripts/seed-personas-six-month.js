#!/usr/bin/env node
'use strict';
/** DevDay-only supplemental seeder. No writes without --apply. Never modifies real events or users. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const DAY = 86400000;
const DEFAULT_PROJECT = 'vis_6bcd1aef732e0d5d';
const DEFAULT_BASE = 'devday_catalog_v2';
const DEFAULT_BATCH = 'devday_personas_six_month_v2';
const PLACES = [
  {country:'India',countryCode:'IN',city:'Mumbai',region:'Maharashtra',latitude:19.0760,longitude:72.8777,timezone:'Asia/Kolkata'},
  {country:'India',countryCode:'IN',city:'Delhi',region:'Delhi',latitude:28.6139,longitude:77.2090,timezone:'Asia/Kolkata'},
  {country:'India',countryCode:'IN',city:'Bengaluru',region:'Karnataka',latitude:12.9716,longitude:77.5946,timezone:'Asia/Kolkata'},
  {country:'United Kingdom',countryCode:'GB',city:'London',region:'England',latitude:51.5072,longitude:-0.1276,timezone:'Europe/London'},
  {country:'United States',countryCode:'US',city:'New York',region:'New York',latitude:40.7128,longitude:-74.0060,timezone:'America/New_York'},
  {country:'Germany',countryCode:'DE',city:'Berlin',region:'Berlin',latitude:52.5200,longitude:13.4050,timezone:'Europe/Berlin'},
  {country:'Singapore',countryCode:'SG',city:'Singapore',region:'Singapore',latitude:1.3521,longitude:103.8198,timezone:'Asia/Singapore'},
  {country:'United Arab Emirates',countryCode:'AE',city:'Dubai',region:'Dubai',latitude:25.2048,longitude:55.2708,timezone:'Asia/Dubai'},
];
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const fraction = s => parseInt(hash(s).slice(0,8),16)/0xffffffff;
const idFor = s => hash(s).slice(0,24);
const monthKey = d => d.toISOString().slice(0,7);
function parseArgs(argv){
  const o={project:DEFAULT_PROJECT,baseBatch:DEFAULT_BASE,batch:DEFAULT_BATCH,days:183,guests:240,signups:24,apply:false,verify:false,cleanup:false};
  for(let i=0;i<argv.length;i++){
    const k=argv[i];
    if(['--apply','--verify','--cleanup'].includes(k)){o[k.slice(2)]=true;continue;}
    if(!['--project','--base-batch','--batch','--days','--guests','--signups','--as-of','--mongo-uri','--confirm-batch','--catalog'].includes(k))throw Error('Unknown argument '+k);
    const v=argv[++i];if(v==null)throw Error('Missing value for '+k);
    const p=k.slice(2).replace(/-([a-z])/g,(_,x)=>x.toUpperCase());o[p]=v;
  }
  for(const k of ['days','guests','signups']){
    o[k]=Number(o[k]);if(!Number.isSafeInteger(o[k])||o[k]<(k==='days'?30:0)||o[k]>(k==='guests'?5000:365))throw Error('Invalid '+k);
  }
  if(!/^[A-Za-z0-9_-]{3,64}$/.test(o.batch)||!/^[A-Za-z0-9_-]{3,64}$/.test(o.baseBatch))throw Error('Invalid batch name');
  if(o.batch===o.baseBatch)throw Error('Supplement batch must differ from base batch');
  if(o.cleanup && (!o.apply||o.confirmBatch!==o.batch))throw Error('Cleanup requires --cleanup --apply --confirm-batch '+o.batch);
  if(!o.cleanup&&!o.verify){if(!o.asOf || !Number.isFinite(Date.parse(o.asOf)))throw Error('Provide --as-of ISO date/time');if(new Date(o.asOf)>new Date())throw Error('--as-of cannot be in the future');}
  return o;
}
function geo(i){return PLACES[i%4===0 ? 3+(Math.floor(i/4)%5) : i%3]}
function event({project,batch,userId=null,sessionId,type,at,properties={},place,device='Desktop',path='/products',seq=0}){
  const key=`${project}|${batch}|${sessionId}|${type}|${seq}`;
  return {_id:idFor(key),projectId:project,seedBatchId:batch,isSynthetic:true,syntheticScenario:'persona_six_month_coverage',event:type,userId,sessionId,timestamp:new Date(at),path,url:'https://dev-day-ecom.web.app'+path,properties,deviceInfo:{deviceType:device,os:device==='Mobile'?'Android':'Windows',browser:'Chrome',geo:{...place}}};
}
function generate({project,batch,asOf,days,guestCount,signupCount,eligibleUserIds,products,existingSignups=[]}){
  if(!products.length)throw Error('No matching product metadata; refusing to invent products');
  const unique=[...new Set(eligibleUserIds.filter(Boolean))].sort((a,b)=>hash(batch+a).localeCompare(hash(batch+b)));
  const now=new Date(asOf);const docs=[];const firsttime=[]; const guestByMonth={};const signupByMonth={};
  const startMs=now.getTime()-days*DAY;
  const months=[];const cursor=new Date(Date.UTC(new Date(startMs).getUTCFullYear(),new Date(startMs).getUTCMonth(),1));
  while(cursor<=now){months.push(monthKey(cursor));cursor.setUTCMonth(cursor.getUTCMonth()+1)}
  const existingByMonth={};for(const s of existingSignups){const m=monthKey(new Date(s.timestamp));existingByMonth[m]=(existingByMonth[m]||0)+1}
  // Spread registrations across months that have the fewest existing registrations;
  // also protect 1d / 7d reporting when there are enough eligible users.
  const actualSignups=Math.min(signupCount,unique.length);
  const selected=[];
  if(actualSignups>0)selected.push(0.35); // visible last 1d
  if(actualSignups>1)selected.push(4.2);  // visible last 7d
  const counts=Object.fromEntries(months.map(m=>[m,existingByMonth[m]||0]));
  for(const age of selected){const m=monthKey(new Date(+now-age*DAY));counts[m]=(counts[m]||0)+1}
  while(selected.length<actualSignups){
    const sorted=[...months].sort((a,b)=>counts[a]-counts[b] || a.localeCompare(b));
    const m=sorted[0];
    const [y,mo]=m.split('-').map(Number);
    const lo=Math.max(startMs,Date.UTC(y,mo-1,1));
    const hi=Math.min(+now-60*1000,Date.UTC(y,mo,1)-1000);
    if(hi<lo)break;
    const rand=fraction(batch+'|signup|'+selected.length);
    const at=new Date(lo+(hi-lo)*(0.15+0.70*rand));
    selected.push((+now-+at)/DAY);counts[m]++;
  }
  for(let i=0;i<selected.length;i++){
    const userId=unique[i],at=new Date(+now-selected[i]*DAY),sessionId='vfs_'+hash(batch+'signup'+userId).slice(0,19);
    docs.push(event({project,batch,userId,sessionId,type:'sign_up',at,place:geo(i),path:'/sign-up',properties:{title:'ShopEasy - Ecommerce'},seq:0}));
    docs.push(event({project,batch,userId,sessionId,type:'page_view',at:new Date(+at+2000),place:geo(i),path:'/products',properties:{title:'ShopEasy - Ecommerce',path:'/products'},seq:1}));
    const p=products[i%products.length];
    docs.push(event({project,batch,userId,sessionId,type:'product_view',at:new Date(+at+30000),place:geo(i),path:'/products-detail/'+p.id,properties:{productId:p.id,name:p.name,brand:p.brand,category:p.category,subCategory:p.subCategory},seq:2}));
    const m=monthKey(at);signupByMonth[m]=(signupByMonth[m]||0)+1;firsttime.push({userId,at:at.toISOString(),month:m});
  }
  for(let i=0;i<guestCount;i++){
    // Fairly spread over all days, with guaranteed recent sessions when possible.
    const age=(i===0 ? 0.25 : i===1 ? 3.3 : (i-1.5)*days/Math.max(1,guestCount-2));
    const jitter=(fraction(batch+'guest-age'+i)-.5)*Math.min(.35,days/guestCount*.4);
    const actualAge=Math.max(.02,Math.min(days-.01,age+jitter));
    const at=new Date(+now-actualAge*DAY);
    const sid='vfg_'+hash(batch+'guest'+i).slice(0,20),place=geo(i);
    const device=i%3===0?'Mobile':'Desktop';const p=products[i%products.length];
    const events=[
      ['page_view',{title:'ShopEasy - Ecommerce',path:'/products'},'/products'],
      ['view_item_list',{title:'ShopEasy - Ecommerce',items:[],totalItems:products.length},'/products'],
      ['select_item',{productId:p.id,name:p.name,category:p.category,subCategory:p.subCategory,brand:p.brand,price:p.price,position:i%12+1},'/products'],
      ['product_view',{productId:p.id,name:p.name,category:p.category,subCategory:p.subCategory,brand:p.brand},'/products-detail/'+p.id],
    ];
    if(i%3===0)events.push(['search_performed',{searchQuery:p.subCategory||p.category,resultsCount:5},'/products']);
    if(i%4===0)events.push(['add_to_cart',{productId:p.id,name:p.name,price:p.price,category:p.category,subCategory:p.subCategory,source:'product_page'},'/products-detail/'+p.id]);
    events.forEach(([type,props,path],seq)=>docs.push(event({project,batch,sessionId:sid,type,at:new Date(+at+seq*15000),properties:props,place,device,path,seq})));
    const m=monthKey(at);guestByMonth[m]=(guestByMonth[m]||0)+1;
  }
  return {docs,summary:{batch,asOf:now.toISOString(),months,eligibleUnusedNonbuyers:unique.length,signupsAdded:firsttime.length,signupByMonth,existingSignupsByMonth:existingByMonth,guestSessions:guestCount,guestSessionsByMonth:guestByMonth,totalDocuments:docs.length,uniqueIdentifiedUsers:new Set(firsttime.map(r=>r.userId)).size}};
}
/** The storefront catalogue is ESM (`export const products = [...]`), while this script is CJS.
 * Parse its JSON-compatible array without executing arbitrary JavaScript. */
function loadCatalogue(catalogPath){
  const source=fs.readFileSync(catalogPath,'utf8').trim();
  let parsed;
  if(catalogPath.toLowerCase().endsWith('.json'))parsed=JSON.parse(source);
  else{
    const match=source.match(/(?:export\s+)?const\s+products\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
    if(!match)throw Error('Catalogue must contain `export const products = [...]` or `const products = [...]`');
    parsed=JSON.parse(match[1]);
  }
  if(!Array.isArray(parsed))throw Error('Product catalogue must be an array');
  const products=parsed.filter(p=>p&&p.id!=null&&String(p.name||'').trim()&&Number.isFinite(Number(p.price))&&Number(p.price)>0)
    .map(p=>({id:p.id,name:p.name,category:p.category||'Unknown',subCategory:p.subCategory||'',brand:p.brand||'',price:Number(p.price)}));
  const unique=new Set(products.map(p=>String(p.id)));
  if(unique.size!==products.length)throw Error('Product catalogue contains duplicate IDs');
  if(products.length<8)throw Error(`Only ${products.length} valid products in catalogue; need at least 8`);
  return products;
}
async function getProducts(events,baseline,catalogPath){
  const file=catalogPath?path.resolve(catalogPath):path.join(__dirname,'products.js');
  if(fs.existsSync(file)){
    const products=loadCatalogue(file);
    // Ensure seeded events and catalogue refer to the same actual product identities.
    const ids=products.map(p=>p.id);
    const observed=await events.aggregate([
      {$match:{...baseline,event:'product_view','properties.productId':{$in:ids}}},
      {$group:{_id:'$properties.productId',name:{$first:'$properties.name'}}},
      {$limit:150}
    ]).toArray();
    const byId=new Map(products.map(p=>[String(p.id),p]));
    const mismatches=observed.filter(p=>p.name&&byId.get(String(p._id))?.name.trim().toLowerCase()!==String(p.name).trim().toLowerCase());
    if(mismatches.length)throw Error('Product catalogue conflicts with seeded product_view names: '+mismatches.slice(0,5).map(p=>String(p._id)).join(', '));
    return {products,source:file,matchedProducts:observed.length};
  }
  if(catalogPath)throw Error('Product catalogue not found: '+file);
  // Fallback for deployments without a catalogue file: obtain prices from events
  // that actually contain them, not from product_view (which commonly lacks price).
  const priced=await events.aggregate([
    {$match:{...baseline,event:{$in:['select_item','add_to_cart']},'properties.productId':{$exists:true}}},
    {$group:{_id:'$properties.productId',name:{$first:'$properties.name'},category:{$first:'$properties.category'},subCategory:{$first:'$properties.subCategory'},brand:{$first:'$properties.brand'},price:{$max:{$convert:{input:'$properties.price',to:'double',onNull:0,onError:0}}}}},
    {$limit:200}
  ]).toArray();
  const products=priced.filter(p=>p._id!=null&&p.name&&p.price>0).map(p=>({id:p._id,name:p.name,category:p.category,subCategory:p.subCategory,brand:p.brand,price:p.price}));
  if(products.length<8)throw Error('Could not reconstruct at least 8 priced products from seed events. Copy the supplied `products.js` into scripts/ or pass --catalog PATH; no writes');
  return {products,source:'seeded select_item/add_to_cart events',matchedProducts:products.length};
}
async function main(){
 const o=parseArgs(process.argv.slice(2));const mongoose=require('mongoose');
 const uri='mongodb+srv://zorooyagami_db_user:CIkhZNwzcx2Xpfu1@vision-engine.e8foaez.mongodb.net/vision?appName=vision-engine'//o.mongoUri||process.env.MONGO_URI||process.env.MONGODB_URI;if(!uri)throw Error('Set MONGO_URI or MONGODB_URI');
 try{
   await mongoose.connect(uri,{serverSelectionTimeoutMS:12000});const events=mongoose.connection.db.collection('events');
   const match={projectId:o.project,seedBatchId:o.batch,isSynthetic:true};
   if(o.cleanup){const r=await events.deleteMany(match);console.log(JSON.stringify({deleted:r.deletedCount,batch:o.batch},null,2));return}
   if(o.verify){const data=await events.aggregate([{$match:match},{$group:{_id:{$dateToString:{format:'%Y-%m',date:'$timestamp'}},guestSessions:{$addToSet:{$cond:[{$eq:['$userId',null]},'$sessionId',null]}},signups:{$sum:{$cond:[{$eq:['$event','sign_up']},1,0]}}}},{$project:{month:'$_id',guestSessions:{$size:{$setDifference:['$guestSessions',[null]]}},signups:1,_id:0}},{$sort:{month:1}}]).toArray();console.log(JSON.stringify({batch:o.batch,data},null,2));return}
   const baseline={projectId:o.project,seedBatchId:o.baseBatch,isSynthetic:true};
   const ids=await events.distinct('userId',{...baseline,userId:{$type:'string'}});
   if(ids.length!==100)throw Error(`Expected 100 seeded identified users in ${o.baseBatch}, found ${ids.length}; no writes`);
   const start=new Date(Date.parse(o.asOf)-o.days*DAY);const end=new Date(o.asOf);
   const [buyerIds,signupIds,existingSignups,catalogue]=await Promise.all([
     events.distinct('userId',{projectId:o.project,event:'purchase',userId:{$in:ids}}),
     events.distinct('userId',{projectId:o.project,event:'sign_up',userId:{$in:ids}}),
     events.find({projectId:o.project,event:'sign_up',timestamp:{$gte:start,$lt:end},userId:{$in:ids}},{projection:{userId:1,timestamp:1,_id:0}}).toArray(),
     getProducts(events,baseline,o.catalog),
   ]);
   const skipped=new Set([...buyerIds,...signupIds]);const unused=ids.filter(id=>!skipped.has(id));
   const {products}=catalogue;
   const {docs,summary}=generate({project:o.project,batch:o.batch,asOf:o.asOf,days:o.days,guestCount:o.guests,signupCount:o.signups,eligibleUserIds:unused,products,existingSignups});
   console.log(JSON.stringify({mode:o.apply?'APPLY':'DRY_RUN',project:o.project,baseBatch:o.baseBatch,previouslySignedUp:signupIds.length,alreadyPurchased:buyerIds.length,catalogueSource:catalogue.source,validProducts:products.length,matchedProductNames:catalogue.matchedProducts,...summary},null,2));
   if(!o.apply){console.log('DRY RUN: zero database writes. Add --apply after reviewing the summary.');return}
   let inserted=0,matched=0;const ObjectId=mongoose.Types.ObjectId;
   for(let i=0;i<docs.length;i+=250){const ops=docs.slice(i,i+250).map(({_id,...d})=>({updateOne:{filter:{_id:new ObjectId(_id)},update:{$setOnInsert:{_id:new ObjectId(_id),...d}},upsert:true}}));const r=await events.bulkWrite(ops,{ordered:false});inserted+=r.upsertedCount;matched+=r.matchedCount}
   console.log(JSON.stringify({inserted,alreadyPresent:matched,batch:o.batch},null,2));
 } finally {await mongoose.disconnect().catch(()=>{})}
}
if(require.main===module)main().catch(e=>{console.error('Seeder failed:',e.message);process.exitCode=1});
module.exports={generate,parseArgs,monthKey,loadCatalogue};
