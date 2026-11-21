'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {build,buckets}=require('../scripts/seed-persona-coverage');
test('creates stable guest and sign-up cohorts across windows',()=>{
 const x={projectId:'project_test',batch:'demo_personas_v1',asOf:new Date('2026-11-20T12:00:00Z'),users:Array.from({length:35},(_,i)=>'user_'+i),catalog:[{id:4,name:'Example',category:'Electronics'}]};
 const a=build(x),b=build(x);
 assert.deepEqual(a.docs,b.docs);
 assert.equal(a.summary.signups,30);
 assert.equal(a.summary.guestSessions,180);
 assert.equal(new Set(a.docs.filter(x=>x.userId===null).map(x=>x.sessionId)).size,180);
 assert.ok(a.docs.every(x=>x.isSynthetic && x.seedBatchId==='demo_personas_v1'));
 assert.ok(a.docs.every(x=>x.timestamp<=new Date('2026-11-20T12:00:00Z')));
 for(const bucket of buckets)assert.equal(a.summary.signupsByWindow[bucket.name],bucket.firsttime);
});
