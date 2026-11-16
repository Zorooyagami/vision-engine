const BehaviorEvent=require('../../models/BehaviorEvent');
const DynamicPersona=require('../../models/DynamicPersona');
const {invalid,membersFor}=require('./core');
function environment(){return 'production';}
function minutes(){return 30;}
async function loadEvents(projectId,env,days=90,now=new Date()) {
 const cap=20000;
 const events=await BehaviorEvent.find({projectId,timestamp:{$gte:new Date(+now-days*86400000),$lte:now}}).sort({timestamp:1,_id:1}).limit(cap+1).maxTimeMS(15000).lean();
 if(events.length>cap)throw invalid('This report exceeds 20,000 behavior records. Choose a shorter observation window.',413);
 return events;
}
async function resolveApproved(projectId,ids,end=new Date()) {
 const definitions=await DynamicPersona.find({projectId,_id:{$in:ids.map(id=>id.replace(/^dynamic:/,''))},status:'approved'}).lean();
 if(definitions.length!==new Set(ids).size)throw invalid('Persona is unavailable, archived, or belongs to another project');
 const sessions=new Set(),users=new Set();
 const events=await loadEvents(projectId,null,90,end);
 for(const def of definitions) for(const member of membersFor(events,def.rule,{now:end,abandonMinutes:minutes()})){
   // Filter on observed session IDs: includes anonymous sessions without selecting all guests.
   member.sessionIds.forEach(s=>sessions.add(s));
 }
 return {sessions,users};
}
module.exports={environment,minutes,loadEvents,resolveApproved};
