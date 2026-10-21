const NODES = {page_view:'Visit',view_item_list:'PLP',product_view:'PDP',add_to_cart:'Add to cart',view_cart:'Cart',checkout_start:'Checkout',purchase:'Purchase'};
const PERSONAS = ['loyal','firsttime','active','guest'];
const ratio = (a,b) => b ? a/b : 0;
function buildSessions(events, loyal = new Set(), firsttime = new Set()) {
 const grouped = new Map(); let missingSessionEvents=0, invalidAmounts=0;
 for(const e of events){
  if(!e.sessionId){missingSessionEvents++;continue;}
  let s=grouped.get(e.sessionId);
  if(!s){s={id:e.sessionId,userId:null,device:'Unknown',events:0,orders:0,revenue:0,currencies:new Set(),path:[],purchased:false};grouped.set(e.sessionId,s);}
  s.events++;
  if(e.userId)s.userId=String(e.userId);
  if(s.device==='Unknown'&&e.deviceInfo?.deviceType)s.device=['Desktop','Mobile','Tablet'].find(d=>d.toLowerCase()===String(e.deviceInfo.deviceType).toLowerCase())||'Unknown';
  if(NODES[e.event]&&!s.purchased&&s.path.at(-1)!==NODES[e.event])s.path.push(NODES[e.event]);
  if(e.event==='purchase'){
   s.purchased=true;s.orders++;
   const raw=e.properties?.total;const amount=raw===null||raw===undefined||raw===''?NaN:Number(raw);
   if(!Number.isFinite(amount)||amount<0){invalidAmounts++;s.invalidAmount=true;}else{s.revenue+=amount;}
   const currency=String(e.properties?.currency||process.env.DASHBOARD_CURRENCY||'').toUpperCase();s.currencies.add(/^[A-Z]{3}$/.test(currency)?currency:'Unspecified');
  }
 }
 const rows=[...grouped.values()].map(s=>({...s,persona:!s.userId?'guest':loyal.has(s.userId)?'loyal':firsttime.has(s.userId)?'firsttime':'active',path:s.path.length?s.path:['Other activity']}));
 return {rows,missingSessionEvents,invalidAmounts};
}
function metrics(rows,moneyAvailable=true){const orders=rows.reduce((n,s)=>n+s.orders,0),purchasingSessions=rows.filter(s=>s.purchased).length;return {sessions:rows.length,events:rows.reduce((n,s)=>n+s.events,0),knownUsers:new Set(rows.filter(s=>s.userId).map(s=>s.userId)).size,guestSessions:rows.filter(s=>s.persona==='guest').length,orders,purchasingSessions,conversion:ratio(purchasingSessions,rows.length)*100,ordersPerPurchasingSession:ratio(orders,purchasingSessions),revenue:moneyAvailable?rows.reduce((n,s)=>n+s.revenue,0):null,aov:moneyAvailable?ratio(rows.reduce((n,s)=>n+s.revenue,0),orders):null};}
function decompose(b,a){if(b.revenue===null||a.revenue===null)return [];return [
 {label:'Sessions',value:(a.sessions-b.sessions)*(b.conversion/100)*b.ordersPerPurchasingSession*b.aov},
 {label:'Purchase conversion',value:a.sessions*((a.conversion-b.conversion)/100)*b.ordersPerPurchasingSession*b.aov},
 {label:'Orders per purchasing session',value:a.sessions*(a.conversion/100)*(a.ordersPerPurchasingSession-b.ordersPerPurchasingSession)*b.aov},
 {label:'Average order value',value:a.sessions*(a.conversion/100)*a.ordersPerPurchasingSession*(a.aov-b.aov)}];}
function breakdown(before,current,dimension,moneyAvailable){const keys=dimension==='persona'?PERSONAS:['Desktop','Mobile','Tablet','Unknown'];return keys.map(key=>{const b=metrics(before.filter(s=>s[dimension]===key),moneyAvailable),a=metrics(current.filter(s=>s[dimension]===key),moneyAvailable);return {key,current:a,previous:b,revenueChange:moneyAvailable?a.revenue-b.revenue:null};});}
function journey(rows){const buyers=rows.filter(s=>s.purchased),nonBuyers=rows.filter(s=>!s.purchased);const nodes=[...Object.values(NODES),'Other activity'];
 const count=(group,node)=>group.filter(s=>s.path.includes(node)).length;
 const paths=(group)=>{const m=new Map();for(const s of group){const key=JSON.stringify(s.path);const p=m.get(key)||{nodes:s.path,count:0};p.count++;m.set(key,p);}return [...m.values()].sort((a,b)=>b.count-a.count).slice(0,8).map(p=>({...p,share:ratio(p.count,group.length)*100}));};
 const neighbours={};for(const node of nodes){neighbours[node]={forward:{},backward:{},sessions:count(rows,node)};for(const s of rows){const at=s.path.indexOf(node);if(at<0)continue;for(const [direction,value] of [['forward',s.path[at+1]||(s.purchased?'Completed':'No later event')],['backward',s.path[at-1]||'Session entry']])neighbours[node][direction][value]=(neighbours[node][direction][value]||0)+1;}}
 return {buyers:buyers.length,nonBuyers:nonBuyers.length,stages:nodes.map(node=>({node,buyers:count(buyers,node),nonBuyers:count(nonBuyers,node),buyerRate:ratio(count(buyers,node),buyers.length)*100,nonBuyerRate:ratio(count(nonBuyers,node),nonBuyers.length)*100})),buyerPaths:paths(buyers),nonBuyerPaths:paths(nonBuyers),neighbours};
}
function makeSnapshot(currentData,previousData,filters){const selected=s=>!filters.personas.length||filters.personas.includes(s.persona);const a=currentData.rows.filter(selected),b=previousData.rows.filter(selected);const currencies=[...new Set([...a,...b].flatMap(s=>[...s.currencies]))];const invalid=[...a,...b].some(s=>s.invalidAmount);const moneyAvailable=currencies.length<=1&&!invalid;const currency=currencies[0]&&currencies[0]!=='Unspecified'?currencies[0]:null;const current=metrics(a,moneyAvailable),previous=metrics(b,moneyAvailable);
 const warnings=[];if(currencies.length>1)warnings.push('Multiple or mixed unspecified currencies: monetary totals are withheld. Normalize currency before comparing revenue.');if(invalid)warnings.push('Some purchase amounts are missing or invalid: monetary totals are withheld.');if(currentData.missingSessionEvents||previousData.missingSessionEvents)warnings.push('Events without session IDs are excluded.');
 return {generatedAt:new Date().toISOString(),scope:{...filters,start:filters.start.toISOString(),end:filters.end.toISOString(),previousStart:filters.previousStart.toISOString(),previousEnd:filters.start.toISOString()},currency,moneyAvailable,warnings,current,previous,revenueChange:moneyAvailable?current.revenue-previous.revenue:null,contributions:decompose(previous,current),devices:breakdown(b,a,'device',moneyAvailable),personas:breakdown(b,a,'persona',moneyAvailable),journey:journey(a),definitions:{conversion:'Purchasing sessions / all sessions × 100. A purchase counts even when revenue is zero.',orders:'Purchase events, not deduplicated order IDs. Duplicate tracking can inflate orders and revenue.',personas:'Loyal = 2+ purchase events lifetime at query time; then signup in each period; then known active; then anonymous. Session uses last known user ID.',journey:'Chronological tracked stages, consecutive repeats collapsed, ending at first purchase. Period boundaries can truncate sessions. Stage reach is not an ordered funnel.',currency:currency||'Currency unspecified; values shown without a currency symbol.',comparison:'Immediately preceding equal-duration period; UTC dates with an exclusive end.',device:'Device from the first recognized device event. Platform web = Desktop; app = Mobile/Tablet, following existing reporting convention.'}};
}
function quickFacts(s){const c=s.current;return [
 {id:'purchases',title:`${c.purchasingSessions} sessions included a purchase`,text:`${c.conversion.toFixed(1)}% of ${c.sessions} sessions converted. ${c.orders} purchase events were recorded.`,to:'/journey-comparison',tone:'purple'},
 {id:'guests',title:`${c.guestSessions} anonymous sessions`,text:`Guests are included in session metrics. ${c.knownUsers} identified users appear in the selection.`,to:'/at-a-glance',tone:'green'},
 {id:'devices',title:'Understand device behaviour',text:s.devices.filter(d=>d.current.sessions).map(d=>`${d.key}: ${d.current.sessions} sessions`).join(' · ')||'No sessions in this selection.',to:'/journey-comparison',tone:'orange'},
 {id:'revenue',title:'Investigate revenue changes',text:s.moneyAvailable?`Compare ${s.current.orders} purchase events with ${s.previous.orders} in the preceding equal-length period.`:'Revenue comparison needs valid amounts in one consistent currency.',to:'/revenue-investigator',tone:'purple'},
 {id:'questions',title:'Ask a question about this selection',text:'Explore revenue, customer personas, devices and journey outcomes with supporting metrics.',to:'/ask-dashboard',tone:'green'}];}
module.exports={NODES,PERSONAS,buildSessions,metrics,decompose,breakdown,journey,makeSnapshot,quickFacts};
