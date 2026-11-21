#!/usr/bin/env node
'use strict';
/** Vision Engine DevDay synthetic journey seeder. Read-only unless --apply. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const IGNORE = new Set(['shop_now_click','shop_now','shop_curated_electronics_fashi_click','page_changed','login_nav','banner_click','add_to_basket_click']);
const BASE_COUNTRIES = [
  {country:'India',countryCode:'IN',city:'Mumbai',region:'Maharashtra',timezone:'Asia/Kolkata'},
  {country:'India',countryCode:'IN',city:'Delhi',region:'Delhi',timezone:'Asia/Kolkata'},
  {country:'India',countryCode:'IN',city:'Bengaluru',region:'Karnataka',timezone:'Asia/Kolkata'},
  {country:'India',countryCode:'IN',city:'Pune',region:'Maharashtra',timezone:'Asia/Kolkata'},
  {country:'India',countryCode:'IN',city:'Hyderabad',region:'Telangana',timezone:'Asia/Kolkata'}
];
const FOREIGN = [
  {country:'United Kingdom',countryCode:'GB',city:'London',region:'England',timezone:'Europe/London'},
  {country:'United States',countryCode:'US',city:'New York',region:'New York',timezone:'America/New_York'},
  {country:'United Arab Emirates',countryCode:'AE',city:'Dubai',region:'Dubai',timezone:'Asia/Dubai'},
  {country:'Singapore',countryCode:'SG',city:'Singapore',region:'Singapore',timezone:'Asia/Singapore'},
  {country:'Germany',countryCode:'DE',city:'Berlin',region:'Berlin',timezone:'Europe/Berlin'}
];
const MS_DAY = 86400000;
const eventNames = ['page_view','view_item_list','product_view','select_item','search_performed','filter_applied','add_to_cart','view_cart','remove_from_cart','checkout_start','shipping_details','purchase','login','checkout_step_error','payment_failed','product_stock_unavailable','search_result_click','coupon_applied'];
function hash(input) { return crypto.createHash('sha256').update(String(input)).digest('hex'); }
function mulberry32(seed) { let a = seed >>> 0; return function () { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15,t | 1); t ^= t + Math.imul(t ^ t >>> 7,t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function randInt(rng,a,b){ return a + Math.floor(rng()*(b-a+1)); }
function pick(rng,list){ return list[Math.floor(rng()*list.length)]; }
function parseArgs(argv) {
  const out = { apply:false, verify:false, cleanup:false, days:183, count:100, batch:'devday_decisions_v1', sample:null };
  for(let i=0;i<argv.length;i++) {
    const a=argv[i];
    if(['--apply','--verify','--cleanup','--fixture','--accept-placeholder-catalog','--allow-catalog-mismatch'].includes(a)) {out[a.slice(2).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=true;continue;}
    if(!a.startsWith('--'))throw Error('Unexpected argument '+a);
    const key=a.slice(2).replace(/-([a-z])/g,(_,x)=>x.toUpperCase());
    if(!['project','mongoUri','currency','days','count','batch','end','output','confirmBatch','catalog'].includes(key))throw Error('Unknown flag '+a);
    out[key]=argv[++i]; if(out[key]===undefined) throw Error('Missing value for '+a);
  }
  out.days=Number(out.days);out.count=Number(out.count);
  if(!Number.isInteger(out.days)||out.days<7||out.days>366)throw Error('--days must be 7..366');
  if(!Number.isInteger(out.count)||out.count<1||out.count>100)throw Error('--count must be 1..100');
  if(!/^[a-zA-Z0-9_-]{3,64}$/.test(out.batch))throw Error('Invalid batch');
  return out;
}
function buildCatalog(raw){
  const m=new Map();
  for(const row of raw){
    if(!row || !row.properties)continue;
    const e=row.event, p=row.properties;
    const candidates = (e==='purchase') ? (Array.isArray(p.products)?p.products:[]) :
      (['view_cart','checkout_start','shipping_details'].includes(e) && Array.isArray(p.products)) ? p.products : [p];
    for(const item of candidates){
      const id=item.productId ?? item.id;
      const name=item.productName ?? item.name;
      const price=Number(item.productPrice ?? item.price);
      if((typeof id!=='string'&&typeof id!=='number') || !String(id).trim() || !name || !Number.isFinite(price) || price<=0)continue;
      const key=String(id);
      if(!m.has(key))m.set(key,{id,name:String(name).slice(0,180),price:Math.round(price*100)/100,category:item.category || p.category || 'Electronics',subCategory:item.subCategory || p.subCategory || 'General',brand:item.brand || p.brand || null});
    }
  }
  return [...m.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
}
/** Parse a local, data-only products.js or JSON file without executing JavaScript. */
function loadCatalogFile(filePath) {
  const source=fs.readFileSync(path.resolve(filePath),'utf8');
  const placeholder=/generated placeholder catalogue|replace with your real product list/i.test(source);
  let raw;
  if(filePath.toLowerCase().endsWith('.json')) {
    raw=JSON.parse(source);
  } else {
    const start=source.search(/\b(?:export\s+)?(?:const|let|var)\s+products\s*=\s*\[/);
    if(start<0)throw Error('Catalog JS must declare products as a literal array, e.g. export const products = [ ... ]; JSON also supported.');
    const open=source.indexOf('[',start);
    // The supplied catalogue is a JSON-compatible JS array; parse as data, never require/eval.
    let depth=0, close=-1, quoted=false, escaped=false;
    for(let i=open;i<source.length;i++) {
      const ch=source[i];
      if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
      if(ch==='"'){quoted=true;continue;}
      if(ch==='[')depth++;
      else if(ch===']' && --depth===0){close=i;break;}
    }
    if(close<0)throw Error('Unclosed products array in catalogue');
    raw=JSON.parse(source.slice(open,close+1));
  }
  const list=Array.isArray(raw)?raw:raw.products;
  if(!Array.isArray(list))throw Error('Expected product array or {products:[...]}');
  const seen=new Set(), out=[];
  for(const row of list){
    const id=row?.id??row?.productId;
    const price=Number(row?.price);
    if((typeof id!=='number'&&typeof id!=='string')||!String(id).trim()||!String(row?.name||'').trim()||!Number.isFinite(price)||price<=0)continue;
    if(seen.has(String(id)))throw Error('Duplicate product ID in catalog: '+id);
    seen.add(String(id));
    out.push({id,name:String(row.name),price:Math.round(price*100)/100,category:row.category||'Uncategorized',subCategory:row.subCategory||'General',brand:row.brand||null,originalPrice:row.originalPrice,discount:row.discount,stock:row.stock,rating:row.rating});
  }
  if(out.length<8)throw Error(`Catalog file has ${out.length} valid products; require at least 8`);
  return {catalog:out,placeholder,sourceCount:list.length};
}
function compareCatalogs(fileCatalog,eventsCatalog) {
  const fileById=new Map(fileCatalog.map(p=>[String(p.id),p]));
  const conflicts=[];
  for(const old of eventsCatalog){
    const current=fileById.get(String(old.id));
    if(!current)continue;
    const nameDiff=current.name.toLowerCase().trim()!==old.name.toLowerCase().trim();
    const priceDiff=Math.abs(current.price-old.price)>Math.max(2,old.price*.15);
    if(nameDiff||priceDiff)conflicts.push({id:old.id,fromExistingEvents:{name:old.name,price:old.price},fromCatalog:{name:current.name,price:current.price}});
  }
  return conflicts;
}
function generate({users,catalog,projectId,currency,batch,days=183,endDate='2026-11-20'}) {
  if(!projectId || !/^\w[\w-]+$/.test(projectId))throw Error('Valid projectId required');
  if(!/^[A-Z]{3}$/.test(currency||''))throw Error('Explicit ISO currency required, e.g. --currency USD (verify actual project currency)');
  if(!Array.isArray(users) || users.length<1 || users.length>100)throw Error('Need 1..100 existing users');
  const ids=users.map(u=>String(u.userId||'')).filter(Boolean);
  if(new Set(ids).size!==users.length)throw Error('User IDs must be non-empty and unique');
  if(!Array.isArray(catalog) || catalog.length<8)throw Error('Need >= 8 actual catalog products with IDs, names, prices');
  const rng=mulberry32(parseInt(hash(batch+'|'+projectId).slice(0,8),16));
  // Fixed UTC endpoint: six months of daily spaced sessions. Explicit backdated synthetic history.
  const end=new Date(endDate+'T00:00:00.000Z');
  if(Number.isNaN(+end))throw Error('Invalid end date');
  const start=new Date(+end-days*MS_DAY);
  const cohorts=['browse','cart_exit','checkout_exit','occasional_buyer','repeat_buyer'];
  const cohortShares=[0.18,0.20,0.14,0.23,0.25];
  const shuffled=[...users].sort((a,b)=>hash(batch+'|'+a.userId).localeCompare(hash(batch+'|'+b.userId)));
  const assignments=shuffled.map((u,i)=>{
    const q=(i+.5)/shuffled.length;
    let cumulative=0, cohort='repeat_buyer';for(let c=0;c<cohorts.length;c++){ cumulative+=cohortShares[c];if(q<cumulative){cohort=cohorts[c];break;} }
    // Exactly 25% of seeded identified users outside India when count is 100.
    const abroad=i<Math.round(shuffled.length*.25);
    const geo=abroad ? FOREIGN[i%FOREIGN.length] : BASE_COUNTRIES[i%BASE_COUNTRIES.length];
    return {userId:String(u.userId),cohort,geo,device:i%5===0?'Mobile':i%7===0?'Tablet':'Desktop'};
  });
  const buyerUsers=assignments.filter(x=>x.cohort.includes('buyer'));
  const catalogByInterest=catalog.slice(0,Math.min(60,catalog.length));
  const highInterest=catalogByInterest[0], highRemove=catalogByInterest[1], strongSeller=catalogByInterest[2], stockIssue=catalogByInterest[3];
  const stats={sessions:0,events:0,purchases:0,purchaseTotal:0,byDay:{},byEvent:{},byCountry:{},byCohort:{},distinctUsers:assignments.length,foreignUsers:assignments.filter(x=>x.geo.countryCode!=='IN').length,products:{highInterest:highInterest.id,highRemove:highRemove.id,strongSeller:strongSeller.id,stockIssue:stockIssue.id}};
  const events=[];
  let sessionCounter=0;
  const add=(obj)=>{
    if(IGNORE.has(obj.event))throw Error('Dummy event was generated');
    events.push(obj);stats.events++;stats.byEvent[obj.event]=(stats.byEvent[obj.event]||0)+1;
  };
  function newEvent(user, session, dayKey, seq, event, props, millis, device, geo) {
    const ts=new Date(millis);
    const pathname=({page_view:'/products',view_item_list:'/products',product_view:'/products-detail',select_item:'/products',add_to_cart:'/products-detail',view_cart:'/cart',remove_from_cart:'/cart',checkout_start:'/cart',shipping_details:'/shipping-info',purchase:'/payment',payment_failed:'/payment',checkout_step_error:'/shipping-info',search_performed:'/products',search_result_click:'/products',product_stock_unavailable:'/products-detail',coupon_applied:'/cart',filter_applied:'/products',login:'/login'})[event]||'/';
    const productId=props.productId ?? props.id;
    const actualPath=pathname==='/products-detail' && productId!=null ? `${pathname}/${productId}`:pathname;
    const isMobile=device!=='Desktop';
    const deviceInfo={deviceType:device,os:isMobile?'Android':'Windows',browser:'Chrome',platform:isMobile?'Linux armv8':'Win32',language:geo.countryCode==='IN'?'en-IN':'en-GB',timezone:geo.timezone,pathname:actualPath,url:`https://dev-day-ecom.web.app${actualPath}`,geo:{country:geo.country,countryCode:geo.countryCode,city:geo.city,region:geo.region,timezone:{id:geo.timezone}}};
    const syntheticKey=`${batch}|${projectId}|${session}|${seq}|${event}`;
    return {_id:hash(syntheticKey).slice(0,24),projectId,event,userId:user.userId,sessionId:session,timestamp:ts,url:`https://dev-day-ecom.web.app${actualPath}`,path:actualPath,referrer:'https://dev-day-ecom.web.app/',deviceInfo,properties:props,trafficSource:seq%5===0?'organic':seq%7===0?'social':'direct',isSynthetic:true,seedBatchId:batch,seedScenario:user.cohort};
  }
  const makeItem=p=>({id:p.id,name:p.name,brand:p.brand,category:p.category,subCategory:p.subCategory,price:p.price,quantity:1});
  const purchaseItem=p=>({productId:p.id,productName:p.name,productPrice:p.price,productQuantity:1});
  for(let day=0;day<days;day++) {
    const date=new Date(+start+day*MS_DAY), d=date.toISOString().slice(0,10);
    // Weekly and multi-week fluctuations; deterministic random variability, never a flat graph.
    const wave= Math.sin(day*2*Math.PI/7)*2.1 + Math.sin(day*2*Math.PI/29)*1.7 + Math.sin(day*2*Math.PI/63)*1.3;
    const sessionsToday=Math.max(5,Math.min(17,Math.round(10+wave+randInt(rng,-2,2))));
    const dayStats={sessions:0,events:0,purchases:0,revenue:0};
    for(let k=0;k<sessionsToday;k++){
      // Rotate through all 100 users, distribute repeat buyers more frequently but preserve base coverage.
      const user=(sessionCounter<assignments.length) ? assignments[sessionCounter] :
        (rng()<.58?pick(rng,buyerUsers):pick(rng,assignments));
      sessionCounter++;
      const session=`vs_${hash(`${batch}|${d}|${k}`).slice(0,20)}`;
      const chosenDevice=(rng()<.12 ? (user.device==='Desktop'?'Mobile':'Desktop') : user.device);
      const maxHour=(date.toISOString().slice(0,10)===new Date().toISOString().slice(0,10)) ? Math.max(0,new Date().getUTCHours()-1) : 22;
      const hour=randInt(rng,maxHour<8?0:8,maxHour);
      let millis=+date+hour*3600000+randInt(rng,0,40)*60000;
      let seq=0;
      const put=(name,props={})=>{
        millis+=randInt(rng,5,70)*1000;
        const ev=newEvent(user,session,d,seq++,name,props,millis,chosenDevice,user.geo);add(ev);dayStats.events++;
      };
      const anchor=(rng()<.35 ? highInterest : rng()<.28 ? highRemove : rng()<.24 ? strongSeller : pick(rng,catalogByInterest));
      const p={productId:anchor.id,name:anchor.name,category:anchor.category,subCategory:anchor.subCategory,brand:anchor.brand,price:anchor.price};
      const basePurchase=user.cohort==='repeat_buyer' ? rng()<.50 : user.cohort==='occasional_buyer' ? rng()<.24 : false;
      const willPurchase=basePurchase && (chosenDevice==='Desktop' || rng()<.45);
      const willCart=willPurchase || user.cohort==='cart_exit' || user.cohort==='checkout_exit' || rng()<.18;
      const willCheckout=willPurchase || user.cohort==='checkout_exit' || (willCart && rng()<.10);
      stats.sessions++;dayStats.sessions++;
      stats.byCountry[user.geo.country]=(stats.byCountry[user.geo.country]||0)+1;
      stats.byCohort[user.cohort]=(stats.byCohort[user.cohort]||0)+1;
      put('page_view',{title:'ShopEasy - Ecommerce',path:'/products',screenWidth:chosenDevice==='Desktop'?1366:390,screenHeight:chosenDevice==='Desktop'?768:844});
      if(rng()<.17)put('login',{title:'ShopEasy - Ecommerce',userId:user.userId});
      put('view_item_list',{title:'ShopEasy - Ecommerce',pageNumber:1,itemsPerPage:20,totalItems:catalog.length,totalPages:Math.ceil(catalog.length/20),sortBy:'relevance',searchQuery:'',items:catalogByInterest.slice(0,5).map(makeItem)});
      if(rng()<.21){ const query=rng()<.18?'rare unavailable item':pick(rng,['headphones','laptop','camera','phone','console']); const resultsCount=query==='rare unavailable item'?0:randInt(rng,3,32);put('search_performed',{searchQuery:query,resultsCount}); if(resultsCount&&rng()<.70)put('search_result_click',{searchQuery:query,productId:anchor.id,position:randInt(rng,1,5)}); }
      if(rng()<.16)put('filter_applied',{filterType:'category',filterValue:anchor.category,action:'add',activeFilters:{categories:[anchor.category]},totalResults:randInt(rng,4,40)});
      put('select_item',{...p,position:randInt(rng,1,12)});
      // High-view, poor-sale product: never purchase anchor 0.
      const viewed=rng()<.35?highInterest:anchor;
      put('product_view',{productId:viewed.id,name:viewed.name,category:viewed.category,subCategory:viewed.subCategory,brand:viewed.brand,position:randInt(rng,1,20)});
      if(viewed.id!==anchor.id && rng()<.7)put('product_view',{productId:anchor.id,name:anchor.name,category:anchor.category,subCategory:anchor.subCategory,brand:anchor.brand,position:randInt(rng,1,20)});
      if(rng()<.055)put('product_stock_unavailable',{productId:stockIssue.id,requestedQuantity:2,availableQuantity:0});
      if(willCart){
        const cartId=`cart_${hash(session).slice(0,16)}`;
        const item= rng()<.33 ? highRemove : anchor;
        const actual=(anchor.id===highInterest.id || (willPurchase && anchor.id===highRemove.id)) ? strongSeller : item;
        put('add_to_cart',{productId:actual.id,price:actual.price,source:'product_page',category:actual.category,subCategory:actual.subCategory,name:actual.name,cartId,quantity:1});
        put('view_cart',{title:'ShopEasy - Ecommerce',cartId,products:[makeItem(actual)],totalPrice:actual.price,totalItems:1});
        if(!willPurchase && (rng()<.46 || actual.id===highRemove.id && rng()<.85)){
          put('remove_from_cart',{id:actual.id,productId:actual.id,category:actual.category,price:actual.price,cartId,quantity:1});
        }
        if(rng()<.12)put('coupon_applied',{cartId,couponCode:'DEMO10',discountAmount:0,accepted:false});
        if(willCheckout){
          put('checkout_start',{title:'ShopEasy - Ecommerce',cartId,products:[makeItem(actual)],totalPrice:actual.price,totalItems:1});
          if(!willPurchase && rng()<.50)put('checkout_step_error',{step:'shipping',errorCode:'DEMO_VALIDATION',cartId});
          else put('shipping_details',{title:'ShopEasy - Ecommerce',cartId,products:[makeItem(actual)],totalPrice:actual.price,totalItems:1});
          if(!willPurchase && rng()<.40)put('payment_failed',{paymentMethod:'card',reasonCode:'DEMO_DECLINED',cartId});
          if(willPurchase){
            const orderId=`DEMO-${hash(session+'|order').slice(0,18)}`;
            put('purchase',{title:'ShopEasy - Ecommerce',orderId,cartId,total:actual.price.toFixed(2),currency,paymentMethod:pick(rng,['card','paypal','googlepay']),products:[purchaseItem(actual)]});
            dayStats.purchases++;dayStats.revenue+=actual.price;
            stats.purchases++;stats.purchaseTotal+=actual.price;
          }
        }
      }
    }
    stats.byDay[d]={...dayStats,revenue:Math.round(dayStats.revenue*100)/100};
  }
  if(events.some(e=>IGNORE.has(e.event)))throw Error('Ignored event leaked');
  if(stats.distinctUsers===100 && stats.foreignUsers!==25)throw Error('Expected exactly 25 foreign users');
  // Six months are deliberately simulated for existing IDs; their actual signup dates are not modified.
  stats.purchaseTotal=Math.round(stats.purchaseTotal*100)/100;
  return {events,stats,assignments,start:start.toISOString(),end:end.toISOString(),currency,projectId,batch};
}
async function main(){
  const args=parseArgs(process.argv.slice(2));
  if(!args.project && !args.fixture)throw Error('--project PROJECT_ID required');
  if(args.cleanup && (!args.apply || args.confirmBatch!==args.batch))throw Error('Cleanup requires --cleanup --apply --confirm-batch EXACT_BATCH');
  if(args.apply && !args.cleanup && !args.end)throw Error('For a reproducible seed, --apply requires a fixed --end YYYY-MM-DD (exclusive UTC boundary)');
  if(!args.cleanup && !args.verify && !args.currency)throw Error('--currency ISO_CODE required. Do not guess currency.');
  const pid=args.project||'vis_fixture';
  let mongoose, conn, users, catalog;
  let catalogWarnings=[],catalogSource='events',catalogMismatches=[];
  try{
    if(args.fixture){
      users=Array.from({length:args.count},(_,i)=>({userId:`fixture_user_${String(i+1).padStart(3,'0')}`}));
      const samples=JSON.parse(fs.readFileSync(path.join(__dirname,'sample-events.json'),'utf8'));
      catalog=buildCatalog(samples);
      if(args.catalog){const loaded=loadCatalogFile(args.catalog);catalog=loaded.catalog;catalogSource='file';if(loaded.placeholder)catalogWarnings.push('Catalogue explicitly identifies itself as GENERATED PLACEHOLDER, not actual storefront products.');}
    }else{
      mongoose=require('mongoose');
      const uri= 'mongodb+srv://zorooyagami_db_user:CIkhZNwzcx2Xpfu1@vision-engine.e8foaez.mongodb.net/vision?appName=vision-engine' //args.mongoUri || process.env.MONGO_URI || process.env.MONGODB_URI;
      if(!uri)throw Error('Set MONGO_URI or --mongo-uri; required even for dry-run to select existing users');
      await mongoose.connect(uri,{serverSelectionTimeoutMS:12000});
      conn=mongoose.connection.db;
      const events=conn.collection('events');
      if(args.cleanup){
        const match={projectId:pid,seedBatchId:args.batch,isSynthetic:true};
        const n=await events.countDocuments(match);
        const deleted=await events.deleteMany(match);
        console.log(JSON.stringify({deleted:deleted.deletedCount,expected:n,batch:args.batch},null,2));return;
      }
      if(args.verify){
        const match={projectId:pid,seedBatchId:args.batch,isSynthetic:true};
        const rows=await events.aggregate([{$match:match},{$group:{_id:'$event',count:{$sum:1}}},{$sort:{count:-1}}]).toArray();
        const byCountry=await events.aggregate([{$match:match},{$group:{_id:'$deviceInfo.geo.country',count:{$sum:1}}}]).toArray();
        const users=await events.distinct('userId',match);
        console.log(JSON.stringify({batch:args.batch,userCount:users.length,events:rows,countries:byCountry},null,2));return;
      }
      const rawUsers=await conn.collection('users').find({$or:[{projectId:pid},{projectId:null},{projectId:{$exists:false}}]},{projection:{userId:1,createdAt:1}}).sort({createdAt:-1,_id:-1}).limit(1000).toArray();
      users=[...new Map(rawUsers.filter(x=>typeof x.userId==='string'&&x.userId.trim()).map(x=>[x.userId,x])).values()].slice(0,args.count);
      if(users.length!==args.count)throw Error(`Found only ${users.length} distinct users scoped to this project/legacy; requested ${args.count}. No inserts.`);
      // Explicit product catalogue takes precedence; event samples are only for safety checks.
      // A small bounded sample is sufficient for mismatches, never loaded into full memory.
      const productEvents=await events.find({projectId:pid,event:{$in:['add_to_cart','product_view','select_item','purchase','checkout_start','view_cart']}},{projection:{event:1,properties:1}}).sort({timestamp:-1}).limit(2500).toArray();
      const existingCatalog=buildCatalog(productEvents);
      if(args.catalog){
        const loaded=loadCatalogFile(args.catalog);
        catalog=loaded.catalog;catalogSource='file';
        if(loaded.placeholder)catalogWarnings.push('Provided products.js explicitly states it is a generated placeholder catalogue; IDs/prices may not match actual ecommerce storefront.');
        catalogMismatches=compareCatalogs(catalog,existingCatalog);
        if(catalogMismatches.length)catalogWarnings.push(`${catalogMismatches.length} product ID(s) conflict with currently recorded event metadata.`);
      }else catalog=existingCatalog;
    }
    if(catalogWarnings.length){for(const warning of catalogWarnings)console.warn('CATALOG WARNING: '+warning);}
    if(catalog.length<8)throw Error(`Only ${catalog.length} valid products found; need at least 8. Stop rather than invent product IDs.`);
    // Include today in the reporting window. Today's synthetic events are kept before current UTC time.
    const today=args.end||new Date(Date.now()+MS_DAY).toISOString().slice(0,10);
    const result=generate({users,catalog,projectId:pid,currency:args.currency||'USD',batch:args.batch,days:args.days,endDate:today});
    const report={projectId:pid,batch:args.batch,catalogSource,catalogWarnings,catalogMismatches:catalogMismatches.slice(0,30),currency:result.currency,range:{start:result.start,end:result.end},existingUsersSelected:users.length,syntheticEvents:result.stats.events,syntheticSessions:result.stats.sessions,syntheticPurchases:result.stats.purchases,syntheticRevenue:result.stats.purchaseTotal,foreignUserCount:result.stats.foreignUsers,distribution:result.stats.byEvent,scenarios:result.stats.products,daily:result.stats.byDay};
    const outPath=args.output||path.resolve(process.cwd(),`vision-seed-preview-${args.batch}.json`);
    fs.writeFileSync(outPath,JSON.stringify(report,null,2));
    console.log(`Report: ${outPath}`);
    console.log(JSON.stringify({users:users.length,products:catalog.length,catalogSource,catalogWarnings,catalogMismatchCount:catalogMismatches.length,events:result.stats.events,sessions:result.stats.sessions,purchases:result.stats.purchases,foreignUsers:result.stats.foreignUsers,revenue:result.stats.purchaseTotal,currency:result.currency,days:args.days,mode:args.apply?'APPLY':'DRY_RUN'},null,2));
    if(!args.apply){console.log('DRY RUN: no database writes. Pass --apply to upsert synthetic events.');return;}
    if(catalogWarnings.some(x=>/placeholder/i.test(x))&&!args.acceptPlaceholderCatalog)throw Error('File says it is a placeholder catalogue. For deliberate demo-only inserts, add --accept-placeholder-catalog after inspecting the preview.');
    if(catalogMismatches.length&&!args.allowCatalogMismatch)throw Error('Product IDs conflict with existing events. Inspect preview and add --allow-catalog-mismatch ONLY if you accept mixed product identities for synthetic demo data.');
    if(args.fixture)throw Error('--fixture is only for local testing; never --apply');
    const events=conn.collection('events');
    let inserted=0,matched=0;
    const {ObjectId}=mongoose.Types;
    for(let i=0;i<result.events.length;i+=300){
      const chunk=result.events.slice(i,i+300);
      const bulk=chunk.map(e=>({updateOne:{filter:{_id:new ObjectId(e._id),projectId:pid},update:{$setOnInsert:{...e,_id:new ObjectId(e._id)}},upsert:true}}));
      const r=await events.bulkWrite(bulk,{ordered:false});
      inserted+=r.upsertedCount;matched+=r.matchedCount;
    }
    console.log(JSON.stringify({inserted,alreadyPresent:matched,batch:args.batch,verify:`node seed-vision.js --project ${pid} --verify --batch ${args.batch}`},null,2));
  } finally { if(mongoose) await mongoose.disconnect(); }
}
if(require.main===module)main().catch(e=>{console.error('Seeder failed:',e.message);process.exitCode=1;});
module.exports={generate,buildCatalog,loadCatalogFile,compareCatalogs,parseArgs,IGNORE};
