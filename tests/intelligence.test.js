const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSessions,metrics,decompose,journey,makeSnapshot}=require('../services/intelligence/core');
const {localIntent,reply}=require('../services/intelligence/ask');
const event=(sessionId,event,total=10,currency='GBP',extra={})=>({sessionId,event,properties:{total,currency},...extra});
const filters={personas:[],projectId:'test-project',platform:'combined',start:new Date('2026-01-02'),end:new Date('2026-01-03'),previousStart:new Date('2026-01-01')};
const snapshot=(a,b=[])=>makeSnapshot(buildSessions(a),buildSessions(b),filters);
test('zero-value purchases convert; multiple orders do not inflate session conversion',()=>{
 const m=metrics(buildSessions([event('a','purchase',0),event('a','purchase',20),event('b','page_view')]).rows);
 assert.equal(m.orders,2);assert.equal(m.purchasingSessions,1);assert.equal(m.conversion,50);assert.equal(m.revenue,20);
});
test('four revenue contributions reconcile including multiple orders and zero baselines',()=>{
 const before=metrics(buildSessions([event('a','purchase',10),event('b','page_view')]).rows);
 const after=metrics(buildSessions([event('a','purchase',30),event('a','purchase',50),event('c','purchase',10)]).rows);
 for(const [b,a] of [[before,after],[metrics([]),after],[after,metrics([])]])assert.ok(Math.abs(decompose(b,a).reduce((n,p)=>n+p.value,0)-(a.revenue-b.revenue))<1e-9);
});
test('mixed currencies and invalid amounts are withheld, unspecified currency has no symbol',()=>{
 assert.equal(snapshot([event('a','purchase',20,'GBP'),event('b','purchase',30,'EUR')]).current.revenue,null);
 assert.equal(snapshot([event('a','purchase',null)]).current.revenue,null);
 const prior=process.env.DASHBOARD_CURRENCY;delete process.env.DASHBOARD_CURRENCY;
 try{const s=snapshot([event('a','purchase',20,'')]);assert.equal(s.currency,null);assert.equal(s.current.revenue,20);}finally{if(prior!==undefined)process.env.DASHBOARD_CURRENCY=prior;}
});
test('journeys collapse repeats and end at first purchase; neighbour totals reconcile',()=>{
 const rows=buildSessions([event('a','page_view'),event('a','page_view'),event('a','checkout_start'),event('a','purchase'),event('a','product_view'),event('b','checkout_start')]).rows;
 assert.deepEqual(rows[0].path,['Visit','Checkout','Purchase']);const j=journey(rows);
 assert.equal(j.buyers,1);assert.equal(j.nonBuyers,1);
 for(const n of Object.values(j.neighbours))for(const d of ['forward','backward'])assert.equal(Object.values(n[d]).reduce((a,b)=>a+b,0),n.sessions);
 assert.equal(j.neighbours.Checkout.backward.Visit,1);assert.equal(j.neighbours.Checkout.backward['Session entry'],1);
});
test('persona precedence, selected persona and missing-session handling',()=>{
 const data=buildSessions([event('a','page_view',0,'GBP',{userId:'u'}),event('b','page_view'),event(null,'page_view')],new Set(['u']),new Set(['u']));
 assert.equal(data.rows[0].persona,'loyal');assert.equal(data.missingSessionEvents,1);
 const s=makeSnapshot(data,buildSessions([]),{...filters,personas:['guest']});assert.equal(s.current.sessions,1);assert.equal(s.current.guestSessions,1);assert.equal(s.warnings.length,1);
});
test('empty data is finite and questions return supported evidence only',()=>{
 const s=snapshot([]);assert.equal(s.current.conversion,0);assert.equal(s.current.aov,0);
 assert.equal(localIntent('How many sessions purchased?'),'journeys');assert.equal(localIntent('Forecast profit next month'),'unsupported');
 assert.equal(reply('unsupported',s).evidence.length,0);assert.equal(reply('summary',s).evidence[0].value,0);
 assert.equal(JSON.stringify(reply('summary',s)).includes('userId'),false);
});
test('queries preserve project and time boundaries; conflicting filters and oversized data fail',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');let captured,rows=[];
 const Event={schema:{path:()=>({cast:x=>x})},find:match=>{captured=match;const chain={select:()=>chain,sort:()=>chain,limit:()=>chain,maxTimeMS:()=>chain,lean:async()=>rows};return chain}};
 function load(file,deps){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services',file),'utf8'),{module,exports:module.exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name]},process,Date,Set,Map,console});return module.exports;}
 const helpers=load('filterHelpers.js',{'../models/Event':Event,'./aggregations':{getLoyalUserIds:async()=>new Set()}});
 const parsing=load('exploreFilters.js',{'../models/Event':Event,'./filterHelpers':helpers});
 const service=load('intelligence/snapshot.js',{'../../models/Event':Event,'../exploreFilters':parsing,'../filterHelpers':{...helpers,getPersonaUserIds:async()=>({ids:new Set()})},'./core':require('../services/intelligence/core')});
 const req={projectId:'project-A',query:{period:'custom',from:'2026-01-01',to:'2026-01-02',platform:'web'}};
 const f=service.readFilters(req);assert.equal(f.end.toISOString(),'2026-01-03T00:00:00.000Z');assert.equal(f.start-f.previousStart,f.end-f.start);
 await service.loadWindow(f,f.start,f.end);assert.equal(captured.projectId,'project-A');assert.equal(captured.timestamp.$lt,f.end);assert.equal(captured['deviceInfo.deviceType'].$in[0],'Desktop');
 assert.throws(()=>service.readFilters({...req,query:{...req.query,device:'Mobile'}}),/conflict/);
 assert.throws(()=>service.readFilters({...req,query:{...req.query,personas:'invalid'}}),/persona/);
 const previous=process.env.INTELLIGENCE_MAX_EVENTS;process.env.INTELLIGENCE_MAX_EVENTS='1000';rows=Array(1001).fill(event('a','page_view'));
 try{await assert.rejects(service.loadWindow(f,f.start,f.end),e=>e.status===413);}finally{if(previous===undefined)delete process.env.INTELLIGENCE_MAX_EVENTS;else process.env.INTELLIGENCE_MAX_EVENTS=previous;}
});
