const Event=require('../../models/Event');
const {readReportingFilters,scalar,invalid}=require('../exploreFilters');
const {getPersonaUserIds,applyPlatformDeviceFilter}=require('../filterHelpers');
const {buildSessions,makeSnapshot,quickFacts}=require('./core');
function readFilters(req){const f=readReportingFilters(req);const raw=scalar(req.query.personas??req.query.persona,'personas','');const personas=[...new Set(raw.split(',').map(x=>x.trim().toLowerCase()).filter(x=>x&&x!=='all'))];if(personas.some(x=>!['loyal','active','firsttime','guest'].includes(x)))throw invalid('Invalid persona');
 if((f.platform==='web'&&f.device&&f.device!=='Desktop')||(f.platform==='app'&&f.device==='Desktop'))throw invalid('Device and platform filters conflict');
 return {...f,personas,previousStart:new Date(f.start.getTime()-(f.end-f.start))};}
async function loadWindow(f,start,end){const match={projectId:f.projectId,timestamp:{$gte:start,$lt:end}};applyPlatformDeviceFilter(match,f.platform,f.device);
 const cap=Math.min(500000,Math.max(1000,Number(process.env.INTELLIGENCE_MAX_EVENTS)||100000));
 const [events,loyal,firsttime]=await Promise.all([
 Event.find(match).select('sessionId userId timestamp event deviceInfo.deviceType properties.total properties.currency').sort({timestamp:1,_id:1}).limit(cap+1).maxTimeMS(20000).lean(),
 getPersonaUserIds(f.projectId,['loyal'],start,end),getPersonaUserIds(f.projectId,['firsttime'],start,end)]);
 if(events.length>cap)throw invalid(`This selection exceeds ${cap} events. Choose a shorter period or narrower filters.`,413);
 return buildSessions(events,loyal.ids,firsttime.ids);}
async function getSnapshot(req){const f=readFilters(req);const [a,b]=await Promise.all([loadWindow(f,f.start,f.end),loadWindow(f,f.previousStart,f.start)]);const s=makeSnapshot(a,b,f);return {...s,facts:quickFacts(s)};}
module.exports={readFilters,loadWindow,getSnapshot};
