const express=require('express');
const router=express.Router();
const {requireProject}=require('../middleware/requireProject');
const {checkOrigin}=require('../middleware/checkOrigin');
const BehaviorEvent=require('../models/BehaviorEvent');
const Event=require('../models/Event');
const DynamicPersona=require('../models/DynamicPersona');
const Session=require('../models/Session');
const {normalizeEvent,analyze,membersFor,validateRule,TEMPLATES,invalid}=require('../services/behavior/core');
const {environment,minutes,loadEvents}=require('../services/behavior/store');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
router.use(requireProject);
router.post('/events',checkOrigin,wrap(async(req,res)=>{
 if(req.project.settings?.analytics===false)throw invalid('Analytics is disabled',403);
 if(!Array.isArray(req.body.events)||!req.body.events.length||req.body.events.length>100)throw invalid('Provide 1–100 events');
 const now=new Date(),events=req.body.events.map(e=>normalizeEvent(e,req.projectId,now));
 // Full validation happens before writing; unique project/eventId makes retries idempotent.
 let result;
 try {result=await BehaviorEvent.bulkWrite(events.map(e=>({updateOne:{filter:{projectId:req.projectId,eventId:e.eventId},update:{$setOnInsert:e},upsert:true}})),{ordered:false});}
 catch(error){if(!error.writeErrors?.length||error.writeErrors.some(e=>e.code!==11000))throw error;result=error.result;}
 res.status(201).json({accepted:events.length,inserted:result?.upsertedCount||0});
}));
async function selection(req){
 const env=environment(),days=Number(req.query.days||30);
 if(!Number.isInteger(days)||days<1||days>90)throw invalid('days must be 1–90');
 const now=new Date();return {env,days,now,events:await loadEvents(req.projectId,env,days,now),abandonMinutes:minutes(env)};
}
router.get('/report',wrap(async(req,res)=>{
 const s=await selection(req);let events=s.events;
 if(req.query.persona){
  if(!/^[a-f0-9]{24}$/i.test(req.query.persona))throw invalid('Invalid persona ID');
  const def=await DynamicPersona.findOne({_id:req.query.persona,projectId:req.projectId,status:'approved'}).lean();
  if(!def)throw invalid('Approved persona not found',404);
  const source=def.rule.windowDays>s.days?await loadEvents(req.projectId,s.env,def.rule.windowDays,s.now):events;
  const sessions=new Set(membersFor(source,def.rule,{now:s.now,abandonMinutes:s.abandonMinutes}).flatMap(a=>a.sessionIds));
  events=events.filter(e=>sessions.has(e.sessionId));
 }
 const result=analyze(events,s),sessions=[...new Set(result.issues.flatMap(i=>i.sessions.map(s=>s.sessionId)))];
 const recordings=await Session.find({projectId:req.projectId,sessionId:{$in:sessions},'chunks.0':{$exists:true}}).select('sessionId').lean();
 const recorded=new Set(recordings.map(r=>r.sessionId));
 result.issues.forEach(i=>i.sessions.forEach(s=>{s.hasReplay=recorded.has(s.sessionId);}));
 res.json({...result,actors:undefined,days:s.days,asOf:s.now,abandonMinutes:s.abandonMinutes,definitions:{cartRate:'Currently abandoned non-empty carts / (purchased + currently abandoned carts). Active and emptied carts are excluded.',checkoutRate:'Currently abandoned checkouts / (purchased + abandoned checkouts).',recovery:'A purchase after a prior non-empty inactivity gap reached the threshold.',window:'Observed activity in the selected window; not lifetime counts. Older cart history may be outside this window.',identity:'Known users and anonymous browser visitors are separate. No probabilistic identity matching.',value:'Observed cart value, grouped by currency; not a forecast of recoverable revenue.'}});
}));
// Evidence-only cart investigation: behavioral sessions, not financial transactions.
router.get('/investigate/cart',wrap(async(req,res)=>{
 const days=Number(req.query.days||30);
 if(!Number.isInteger(days)||days<1||days>365)throw invalid('days must be 1–365');
 const page=Number(req.query.page||1),pageSize=Number(req.query.pageSize||8);
 const status=String(req.query.status||'all');
 if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>20)throw invalid('Invalid investigation page or page size');
 if(!['all','cart_no_checkout','checkout_no_purchase','cart_emptied','purchase_recorded'].includes(status))throw invalid('Invalid investigation outcome');
 const hasCustomRange=req.query.from!==undefined || req.query.to!==undefined;
 if(hasCustomRange && (!req.query.from || !req.query.to || !/^\d{4}-\d{2}-\d{2}$/.test(req.query.from) || !/^\d{4}-\d{2}-\d{2}$/.test(req.query.to)))throw invalid('Provide valid from and to dates (YYYY-MM-DD)');
 const now=hasCustomRange?new Date(`${req.query.to}T23:59:59.999Z`):new Date();
 const start=hasCustomRange?new Date(`${req.query.from}T00:00:00.000Z`):new Date(+now-days*86400000);
 if(!Number.isFinite(+start)||!Number.isFinite(+now)||start>now||now-start>365*86400000+86400000)throw invalid('Invalid investigation date range (maximum 365 days)');
 const scanDays=Math.min(365,Math.ceil((now-start)/86400000)+1);
 // Query both event schemas: older SDKs only emitted standard analytics events.
 // Query only relevant names; never infer a cart from a page_view alone.
 const analyticsKinds=['add_to_cart','view_cart','remove_from_cart','checkout_start','purchase','validation_failure','repeated_click','javascript_error','action_failure'];
 const [behavior,analytics]=await Promise.all([
   loadEvents(req.projectId,null,scanDays,now),
   Event.find({projectId:req.projectId,timestamp:{$gte:start,$lte:now},event:{$in:analyticsKinds}})
     .sort({timestamp:1,_id:1}).limit(20001).maxTimeMS(15000).lean()
 ]);
 if(analytics.length>20000)throw invalid('Too many standard analytics events to inspect completely. Choose a shorter time window.',413);
 const scopedBehavior=behavior.filter(e=>new Date(e.timestamp)>=start);
 const {investigateCart}=require('../services/behavior/cartInvestigator');
 const result=investigateCart(scopedBehavior,{now,limit:pageSize,offset:(page-1)*pageSize,status,analyticsEvents:analytics});
 const ids=result.cases.map(c=>c.sessionId);
 const recordings=ids.length?await Session.find({projectId:req.projectId,sessionId:{$in:ids},'chunks.0':{$exists:true}}).select('sessionId userId').lean():[];
 const available=new Map(recordings.map(r=>[r.sessionId,r.userId]));
 result.cases.forEach(c=>{c.hasReplay=available.has(c.sessionId);if(c.hasReplay)c.recordingUserId=available.get(c.sessionId);});
 res.json({...result,asOf:now,days,from:start,to:now,scannedEvents:scopedBehavior.length+analytics.length,caseLimit:pageSize,page,pageSize,status,
   caveat:'Historical analytics-only sessions have no recorded cart ID: subsequent steps are matched only by session and event time, not confirmed for the same cart. Missing purchase does not prove abandonment.'});
}));
router.get('/definitions',wrap(async(req,res)=>{res.json({personas:await DynamicPersona.find({projectId:req.projectId,status:'approved'}).select('name rule revision').lean()});}));
router.get('/personas',wrap(async(req,res)=>{
 const env=environment(),defs=await DynamicPersona.find({projectId:req.projectId}).sort({createdAt:-1}).lean();
 const now=new Date(),events=await loadEvents(req.projectId,env,90,now),options={now,abandonMinutes:minutes(env)};
 const personas=defs.map(d=>{const members=membersFor(events,d.rule,options);const {environment:legacyEnvironment,...publicDefinition}=d;return {...publicDefinition,id:'dynamic:'+d._id,members:members.length,purchasers:members.filter(m=>m.purchases>0).length};});
 res.json({personas,asOf:now});
}));
router.post('/personas/suggest',wrap(async(req,res)=>{
 const env=environment(),now=new Date(),events=await loadEvents(req.projectId,env,90,now);let suggested=0;
 for(const candidate of TEMPLATES){if(!membersFor(events,candidate.rule,{now,abandonMinutes:minutes(env)}).length)continue;
  await DynamicPersona.updateOne({projectId:req.projectId,environment:'production',slug:candidate.slug},{$setOnInsert:{...candidate,environment:'production',status:'suggested',revision:1}},{upsert:true});suggested++;
 }
 res.json({evaluated:TEMPLATES.length,matchingTemplates:suggested});
}));
router.post('/personas/preview',wrap(async(req,res)=>{
 const env=environment(),rule=validateRule(req.body.rule),now=new Date(),events=await loadEvents(req.projectId,env,rule.windowDays,now);
 const members=membersFor(events,rule,{now,abandonMinutes:minutes(env)}),eligible=analyze(events,{now,abandonMinutes:minutes(env)}).actors.length;
 res.json({count:members.length,eligible,share:eligible?members.length/eligible*100:0,members:members.slice(0,100),previewLimit:100,asOf:now});
}));
router.post('/personas',wrap(async(req,res)=>{
 const name=String(req.body.name||'').trim().slice(0,80);if(!name)throw invalid('Name required');
 const def=await DynamicPersona.create({projectId:req.projectId,environment:'production',name,slug:'custom-'+require('crypto').randomUUID(),rule:validateRule(req.body.rule),status:'suggested'});
 res.status(201).json({persona:def});
}));
router.patch('/personas/:id',wrap(async(req,res)=>{
 if(!/^[a-f0-9]{24}$/i.test(req.params.id))throw invalid('Invalid persona ID');
 const before=await DynamicPersona.findOne({_id:req.params.id,projectId:req.projectId}).lean();if(!before)throw invalid('Persona not found',404);
 if(req.body.revision!==before.revision)throw invalid('Persona changed. Reload before saving.',409);
 const next={name:before.name,rule:before.rule,status:before.status};
 if(req.body.name!==undefined){next.name=String(req.body.name).trim().slice(0,80);if(!next.name)throw invalid('Name required');}
 if(req.body.rule!==undefined)next.rule=validateRule(req.body.rule);
 if(req.body.status!==undefined){if(!['suggested','approved','dismissed','archived'].includes(req.body.status))throw invalid('Invalid status');next.status=req.body.status;}
 const result=await DynamicPersona.findOneAndUpdate({_id:before._id,projectId:req.projectId,revision:before.revision},{$set:next,$inc:{revision:1},$push:{history:{$each:[{revision:before.revision,name:before.name,rule:before.rule,status:before.status,at:new Date()}],$slice:-50}}},{new:true});
 if(!result)throw invalid('Persona changed. Reload before saving.',409);
 res.json({persona:result});
}));
module.exports=router;
