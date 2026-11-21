const router=require('express').Router();
const {requireProject}=require('../middleware/requireProject');
const OpportunityStatus=require('../models/OpportunityStatus');
const {loadIntelligence,invalidate}=require('../services/decisionIntelligence');
router.use(requireProject);
router.get('/', async(req,res)=>{
 try { const data=await loadIntelligence(req.projectId,req.query);res.set('Cache-Control','private, max-age=30');res.json(data); }
 catch(err){console.error('[decision-intelligence]',err);res.status(err.status||503).json({error:err.status?err.message:'Decision analysis unavailable. Retry or narrow the time range.'});}
});
router.put('/:key/status', async(req,res)=>{
 try {
  const key=String(req.params.key||'');
  if(!/^di:[a-zA-Z0-9-]{1,120}$/.test(key))return res.status(400).json({error:'Invalid decision key'});
  if(!['new','investigating','planned','in_progress','resolved','dismissed'].includes(req.body?.status))return res.status(400).json({error:'Invalid status'});
  const note=String(req.body?.note||'').slice(0,1000);
  const doc=await OpportunityStatus.findOneAndUpdate({projectId:req.projectId,opportunityKey:key},{$set:{status:req.body.status,note,updatedAt:new Date()}},{upsert:true,new:true,runValidators:true});
  invalidate(req.projectId);res.json({key:doc.opportunityKey,status:doc.status,note:doc.note});
 }catch(err){console.error('[decision-status]',err);res.status(500).json({error:'Could not save decision status'});}
});
module.exports=router;
