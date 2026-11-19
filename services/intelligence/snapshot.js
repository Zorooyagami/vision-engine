const Event = require('../../models/Event');
const {readReportingFilters,scalar,invalid}=require('../exploreFilters');
const {getPersonaUserIds,applyPlatformDeviceFilter,applyPersonaFilter}=require('../filterHelpers');
const {buildSessions,makeSnapshot,quickFacts}=require('./core');

const timeout = () => Math.min(120000, Math.max(15000, Number(process.env.INTELLIGENCE_QUERY_TIMEOUT_MS) || 45000));
const capValue = () => Math.min(500000,Math.max(1000,Number(process.env.INTELLIGENCE_MAX_EVENTS)||100000));
function readFilters(req){const f=readReportingFilters(req);const raw=scalar(req.query.personas??req.query.persona,'personas','');const personas=[...new Set(raw.split(',').map(x=>x.trim().toLowerCase()).filter(x=>x&&x!=='all'))];if(personas.some(x=>!['loyal','active','firsttime','guest'].includes(x)&&!/^dynamic:[a-f0-9]{24}$/.test(x)))throw invalid('Invalid persona');
 if((f.platform==='web'&&f.device&&f.device!=='Desktop')||(f.platform==='app'&&f.device==='Desktop'))throw invalid('Device and platform filters conflict');
 return {...f,personas,previousStart:new Date(f.start.getTime()-(f.end-f.start))};}

// Persona sets can be shared between windows. In particular, lifetime loyal users
// must NOT be re-aggregated separately for the current and comparison windows.
async function loadWindow(f,start,end,personaSets){
 const match={projectId:f.projectId,timestamp:{$gte:start,$lt:end}};applyPlatformDeviceFilter(match,f.platform,f.device);
 if(f.personas.some(p=>p.startsWith('dynamic:')))applyPersonaFilter(match,await getPersonaUserIds(f.projectId,f.personas,start,end));
 const cap=capValue();
 const eventPromise=Event.find(match)
   .select('sessionId userId timestamp event deviceInfo.deviceType properties.total properties.currency properties.orderId properties.order_id properties.environment')
   .sort({timestamp:1,_id:1}).limit(cap+1).maxTimeMS(timeout()).lean();
 const [events,loyal,firsttime]=await Promise.all([
   eventPromise,
   personaSets ? Promise.resolve(personaSets.loyal) : getPersonaUserIds(f.projectId,['loyal'],start,end),
   personaSets ? Promise.resolve(personaSets.firsttime) : getPersonaUserIds(f.projectId,['firsttime'],start,end),
 ]);
 if(events.length>cap)throw invalid(`This selection exceeds ${cap} events. Choose a shorter period or narrower filters.`,413);
 return buildSessions(events,loyal.ids,firsttime.ids);
}

async function getSnapshot(req){
 const f=readFilters(req);
 // Resolve lifetime loyalty once. Resolve first-time signup membership separately for
 // each window, preserving the original persona definitions and date boundaries.
 const loyal = await getPersonaUserIds(f.projectId,['loyal'],f.previousStart,f.end);
 const [firsttimeCurrent,firsttimePrevious] = await Promise.all([
   getPersonaUserIds(f.projectId,['firsttime'],f.start,f.end,{loyalIds:loyal.ids}),
   getPersonaUserIds(f.projectId,['firsttime'],f.previousStart,f.start,{loyalIds:loyal.ids}),
 ]);
 const [a,b]=await Promise.all([
   loadWindow(f,f.start,f.end,{loyal,firsttime:firsttimeCurrent}),
   loadWindow(f,f.previousStart,f.start,{loyal,firsttime:firsttimePrevious}),
 ]);
 const s=makeSnapshot(a,b,{...f,personas:f.personas.some(p=>p.startsWith('dynamic:'))?[]:f.personas});s.scope.personas=f.personas;return {...s,facts:quickFacts(s)};
}
module.exports={readFilters,loadWindow,getSnapshot};
