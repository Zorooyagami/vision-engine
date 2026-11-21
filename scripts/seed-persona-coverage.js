#!/usr/bin/env node
'use strict';
/** Supplemental, labelled and removable DevDay persona dataset. DRY RUN by default. */
const crypto = require('node:crypto');
const DAY = 86400000;
const PROJECT = 'vis_6bcd1aef732e0d5d';
const BASE_BATCH = 'devday_catalog_v2';
const EXTRA_BATCH = 'devday_personas_v1';
const buckets = [
  { name: 'last_1d', min: 0.08, max: 0.8, guest: 4, firsttime: 2 },
  { name: 'days_2_to_7', min: 1.2, max: 6.5, guest: 12, firsttime: 4 },
  { name: 'days_8_to_30', min: 7.2, max: 29.5, guest: 32, firsttime: 8 },
  { name: 'days_31_to_90', min: 30.5, max: 89.5, guest: 54, firsttime: 8 },
  { name: 'days_91_to_180', min: 90.5, max: 179.5, guest: 78, firsttime: 8 },
];
const places = [
  ['India','IN','Mumbai','Maharashtra','Asia/Kolkata'],
  ['India','IN','Delhi','Delhi','Asia/Kolkata'],
  ['India','IN','Bengaluru','Karnataka','Asia/Kolkata'],
  ['United Kingdom','GB','London','England','Europe/London'],
  ['United States','US','New York','New York','America/New_York'],
  ['Singapore','SG','Singapore','Singapore','Asia/Singapore'],
  ['Germany','DE','Berlin','Berlin','Europe/Berlin'],
  ['United Arab Emirates','AE','Dubai','Dubai','Asia/Dubai'],
];
function digest(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function objectId(s) { return digest(s).slice(0,24); }
function number(s) { return parseInt(digest(s).slice(0,8),16)/0xffffffff; }
function argsOf(a) {
  const opts={project:PROJECT,baseBatch:BASE_BATCH,batch:EXTRA_BATCH,apply:false,verify:false,cleanup:false};
  for(let i=0;i<a.length;i++) {
    const key=a[i];
    if(['--apply','--verify','--cleanup'].includes(key)){opts[key.slice(2)]=true;continue;}
    if(!['--project','--base-batch','--batch','--as-of','--mongo-uri','--confirm-batch'].includes(key)) throw Error('Unsupported argument: '+key);
    const val=a[++i]; if(!val)throw Error('Missing value after '+key);
    opts[key.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=val;
  }
  if(!/^[a-z0-9_-]{3,64}$/i.test(opts.batch)||!/^[a-z0-9_-]{3,64}$/i.test(opts.baseBatch))throw Error('Invalid batch name');
  if(!opts.asOf && !opts.verify && !opts.cleanup)throw Error('Supply --as-of ISO timestamp for deterministic dry-run and apply');
  if(opts.cleanup && (!opts.apply || opts.confirmBatch!==opts.batch))throw Error('Cleanup requires --cleanup --apply --confirm-batch MATCHING_BATCH');
  if(opts.asOf && (!Number.isFinite(Date.parse(opts.asOf)) || new Date(opts.asOf)>new Date()))throw Error('--as-of must be a valid non-future ISO timestamp');
  return opts;
}
function geoFor(i) {
  // 25% of guest sessions outside India. Identity count remains governed by original seed.
  const idx=i%4===0 ? 3 + (Math.floor(i/4)%5) : i%3;
  const [country,countryCode,city,region,timezone]=places[idx];
  return {country,countryCode,city,region,timezone};
}
function dateFor(asOf, bucket, id) {
  const age=bucket.min+(bucket.max-bucket.min)*number(id);
  return new Date(asOf.getTime()-age*DAY);
}
function eventDoc({projectId,batch,userId,sessionId,timestamp,event,properties={},geo,deviceType='Desktop',path='/products',seq=0}) {
  const hex=objectId(`${projectId}|${batch}|${sessionId}|${event}|${seq}`);
  return {
    _id:hex, projectId, seedBatchId:batch, isSynthetic:true,
    syntheticScenario:'persona_coverage', event, userId, sessionId, timestamp,
    path, url:'https://dev-day-ecom.web.app'+path,
    properties, deviceInfo:{deviceType,geo:{...geo},os:deviceType==='Mobile'?'Android':'Windows',browser:'Chrome'},
  };
}
function build({projectId,batch,asOf,users,catalog}) {
  if(!users.length)throw Error('No eligible non-buyer, never-signed-up users. Stopping rather than inventing user IDs.');
  const docs=[];const assigned=[];let guestSequence=0;
  const goal=buckets.reduce((s,b)=>s+b.firsttime,0);
  const chosen=[...users].sort((a,b)=>digest(batch+'|'+a).localeCompare(digest(batch+'|'+b))).slice(0,goal);
  let u=0;
  for(const b of buckets) {
    for(let n=0;n<b.firsttime && u<chosen.length;n++,u++) {
      const id=chosen[u], date=dateFor(asOf,b,`${batch}|signup|${id}`);
      const sessionId=`vpf_${digest(batch+'|signup|'+id).slice(0,18)}`;
      docs.push(eventDoc({projectId,batch,userId:id,sessionId,timestamp:date,event:'sign_up',path:'/sign-up',properties:{title:'ShopEasy - Ecommerce',source:'synthetic_persona_coverage'},geo:geoFor(u),seq:0}));
      assigned.push({userId:id,window:b.name,at:date.toISOString()});
    }
    for(let n=0;n<b.guest;n++,guestSequence++) {
      const key=`${batch}|guest|${guestSequence}`, date=dateFor(asOf,b,key);
      const sessionId=`vpg_${digest(key).slice(0,20)}`;
      const geo=geoFor(guestSequence), deviceType=guestSequence%3===0?'Mobile':'Desktop';
      const p=catalog[guestSequence%catalog.length];
      const props={productId:p.id,name:p.name,category:p.category||'Electronics',subCategory:p.subCategory||'General',brand:p.brand||null,price:p.price};
      const steps=[
        ['page_view',{title:'ShopEasy - Ecommerce',path:'/products'},'/products'],
        ['view_item_list',{title:'ShopEasy - Ecommerce',items:[],totalItems:catalog.length},'/products'],
        ['select_item',{...props,position:(guestSequence%12)+1},'/products'],
        ['product_view',{...props},`/products-detail/${p.id}`],
      ];
      if(guestSequence%4===0)steps.push(['search_performed',{searchQuery:p.subCategory||p.category,resultsCount:5},'/products']);
      if(guestSequence%5===0)steps.push(['add_to_cart',{...props,source:'product_page',quantity:1},`/products-detail/${p.id}`]);
      steps.forEach(([event,properties,path],seq)=>docs.push(eventDoc({projectId,batch,userId:null,sessionId,timestamp:new Date(+date+seq*15000),event,properties,path,geo,deviceType,seq})));
    }
  }
  const guestSessions=buckets.reduce((s,b)=>s+b.guest,0);
  return {docs,summary:{eligibleNonBuyers:users.length,signups:assigned.length,signupsByWindow:assigned.reduce((o,a)=>(o[a.window]=(o[a.window]||0)+1,o),{}),guestSessions,guestByWindow:Object.fromEntries(buckets.map(b=>[b.name,b.guest])),guestEvents:docs.length-assigned.length,syntheticUsersAffected:assigned.length}};
}
async function main(){
  const opts=argsOf(process.argv.slice(2));
  let mongoose;
  try {
    mongoose=require('mongoose');
    const uri= 'mongodb+srv://zorooyagami_db_user:CIkhZNwzcx2Xpfu1@vision-engine.e8foaez.mongodb.net/vision?appName=vision-engine'//opts.mongoUri||process.env.MONGO_URI||process.env.MONGODB_URI;
    if(!uri)throw Error('Set MONGO_URI / MONGODB_URI (or --mongo-uri)');
    await mongoose.connect(uri,{serverSelectionTimeoutMS:12000});
    const events=mongoose.connection.db.collection('events');
    const target={projectId:opts.project,seedBatchId:opts.batch,isSynthetic:true};
    if(opts.cleanup){const r=await events.deleteMany(target);console.log(JSON.stringify({deleted:r.deletedCount,batch:opts.batch},null,2));return;}
    if(opts.verify){
      const rows=await events.aggregate([{$match:target},{$group:{_id:'$event',count:{$sum:1},sessions:{$addToSet:'$sessionId'}}},{$project:{event:'$_id',count:1,sessionCount:{$size:'$sessions'},_id:0}},{$sort:{event:1}}]).toArray();
      console.log(JSON.stringify({batch:opts.batch,rows},null,2));return;
    }
    const asOf=new Date(opts.asOf);
    const base={projectId:opts.project,seedBatchId:opts.baseBatch,isSynthetic:true};
    const userIds=await events.distinct('userId',{...base,userId:{$type:'string'}});
    if(userIds.length!==100)throw Error(`Expected exactly 100 identified users in ${opts.baseBatch}; found ${userIds.length}. No writes.`);
    // Do not create a new sign_up for real purchasers, existing signup users, or buyers in the base seed.
    const [buyerIds,signupIds]=await Promise.all([
      events.distinct('userId',{projectId:opts.project,event:'purchase',userId:{$in:userIds}}),
      events.distinct('userId',{projectId:opts.project,event:'sign_up',seedBatchId:{$ne:opts.batch},userId:{$in:userIds}}),
    ]);
    const skip=new Set([...buyerIds,...signupIds]);
    const eligible=userIds.filter(id=>!skip.has(id));
    const rawProducts=await events.aggregate([
      {$match:{...base,event:'product_view','properties.productId':{$exists:true}}},
      {$group:{_id:'$properties.productId',name:{$first:'$properties.name'},category:{$first:'$properties.category'},subCategory:{$first:'$properties.subCategory'},brand:{$first:'$properties.brand'},price:{$first:'$properties.price'}}},
      {$limit:30},
    ]).toArray();
    const catalog=rawProducts.filter(p=>p._id!=null).map(p=>({id:p._id,name:p.name||`Product ${p._id}`,category:p.category,subCategory:p.subCategory,brand:p.brand,price:p.price}));
    if(!catalog.length)throw Error('No seeded product_view metadata found; no writes.');
    const {docs,summary}=build({projectId:opts.project,batch:opts.batch,asOf,users:eligible,catalog});
    console.log(JSON.stringify({mode:opts.apply?'APPLY':'DRY_RUN',baseBatch:opts.baseBatch,batch:opts.batch,asOf:asOf.toISOString(),...summary,totalEvents:docs.length},null,2));
    if(!opts.apply){console.log('DRY RUN: zero database writes. Add --apply after reviewing the summary.');return;}
    const {ObjectId}=mongoose.Types;let inserted=0,matched=0;
    for(let i=0;i<docs.length;i+=250){
      const ops=docs.slice(i,i+250).map(({_id,...record})=>({updateOne:{filter:{_id:new ObjectId(_id),projectId:opts.project},update:{$setOnInsert:{_id:new ObjectId(_id),...record}},upsert:true}}));
      const r=await events.bulkWrite(ops,{ordered:false});inserted+=r.upsertedCount;matched+=r.matchedCount;
    }
    console.log(JSON.stringify({inserted,alreadyPresent:matched,batch:opts.batch},null,2));
  } finally {if(mongoose)await mongoose.disconnect().catch(()=>{});}
}
if(require.main===module)main().catch(e=>{console.error('Seeder failed:',e.message);process.exitCode=1;});
module.exports={build,argsOf,buckets};
