const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const express=require('express'),request=require('supertest'),mongoose=require('mongoose');const {MongoMemoryServer}=require('mongodb-memory-server');
let mongo,app;let n=0;const project='project-A',origin='https://demo.example';
const e=(kind,data={},extra={})=>({eventId:'id'+(++n),kind,environment:'demo',visitorId:'visitor1',sessionId:'session1',timestamp:new Date(Date.now()-120000).toISOString(),path:'/cart',device:'Desktop',data,...extra});
const send=(events,p=project)=>request(app).post('/api/behavior/events').set('Origin',origin).set('X-Project-Id',p).send({events});
before(async()=>{
 mongo=await MongoMemoryServer.create({instance:{dbPath:require('fs').mkdtempSync(require('path').join(process.env.VISION_TEST_TMP || require('os').tmpdir(),'vision-mongo-')),args:['--nounixsocket','--setParameter','diagnosticDataCollectionEnabled=false']}});await mongoose.connect(mongo.getUri());
 const Project=require('../models/Project');await Project.create([{projectId:project,name:'A',websiteUrl:origin,allowedOrigins:[origin]},{projectId:'project-B',name:'B',websiteUrl:origin,allowedOrigins:[origin]}]);
 await require('../models/BehaviorEvent').init();await require('../models/DynamicPersona').init();
 app=express();app.use(express.json());app.use('/api/behavior',require('../routes/behavior'));app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
}, {timeout:120000});
after(async()=>{await mongoose.disconnect();await mongo?.stop()});
test('idempotent ingestion, origin gate, demo/production and project isolation',async()=>{
 const event=e('cart_updated',{cartId:'cart1',version:1,currency:'USD',value:20,itemCount:1});await send([event]).expect(201);await send([event]).expect(201);
 const B=require('../models/BehaviorEvent');assert.equal(await B.countDocuments({projectId:project,eventId:event.eventId}),1);
 await request(app).post('/api/behavior/events').set('X-Project-Id',project).set('Origin','https://evil.example').send({events:[event]}).expect(403);
 const report=await request(app).get('/api/behavior/report?environment=demo').set('X-Project-Id',project).expect(200);assert.equal(report.body.summary.abandoned,1);
 const other=await request(app).get('/api/behavior/report?environment=demo').set('X-Project-Id','project-B').expect(200);assert.equal(other.body.summary.carts,0);
 const prod=await request(app).get('/api/behavior/report?environment=production').set('X-Project-Id',project).expect(200);assert.equal(prod.body.summary.carts,0);
});
test('suggest → preview → approve → filter → revise → archive; stale revision rejected',async()=>{
 await send([e('product_view'),e('product_view'),e('product_view')]).expect(201);
 await request(app).post('/api/behavior/personas/suggest').set('X-Project-Id',project).send({environment:'demo'}).expect(200);
 const list=await request(app).get('/api/behavior/personas?environment=demo').set('X-Project-Id',project).expect(200);const p=list.body.personas.find(d=>d.slug==='product-explorers');assert.ok(p);assert.equal(p.members,1);
 const preview=await request(app).post('/api/behavior/personas/preview').set('X-Project-Id',project).send({environment:'demo',rule:p.rule}).expect(200);assert.equal(preview.body.count,1);
 await request(app).patch('/api/behavior/personas/'+p._id).set('X-Project-Id','project-B').send({revision:1,status:'approved'}).expect(404);
 await request(app).patch('/api/behavior/personas/'+p._id).set('X-Project-Id',project).send({revision:1,status:'approved'}).expect(200);
 await request(app).patch('/api/behavior/personas/'+p._id).set('X-Project-Id',project).send({revision:1,status:'archived'}).expect(409);
 const filter=await require('../services/filterHelpers').getPersonaUserIds(project,['dynamic:'+p._id],new Date(Date.now()-86400000),new Date());assert.ok(filter.sessions.has('session1'));assert.equal(filter.includeGuest,false);
 await request(app).get('/api/behavior/report?environment=demo&persona='+p._id).set('X-Project-Id',project).expect(200);
 await request(app).patch('/api/behavior/personas/'+p._id).set('X-Project-Id',project).send({revision:2,status:'archived'}).expect(200);
 await request(app).get('/api/behavior/report?environment=demo&persona='+p._id).set('X-Project-Id',project).expect(404);
});
test('malformed batches are rejected before writes; bad rules and environments return 400',async()=>{
 await request(app).get('/api/behavior/report?persona=invalid').set('X-Project-Id',project).expect(400);
 const valid=e('page_view'),bad=e('cart_updated',{cartId:'bad'});
 await send([valid,bad]).expect(400);assert.equal(await require('../models/BehaviorEvent').countDocuments({eventId:valid.eventId}),0);
 await request(app).get('/api/behavior/report?environment=invalid').set('X-Project-Id',project).expect(400);
 await request(app).post('/api/behavior/personas/preview').set('X-Project-Id',project).send({environment:'demo',rule:{windowDays:7,conditions:[null]}}).expect(400);
});
