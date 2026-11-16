const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeEvent}=require('../services/behavior/core');
const {buildSessions}=require('../services/intelligence/core');
const now=new Date('2026-11-16T10:00:00.000Z');
const base={eventId:'legacy_1',kind:'page_view',visitorId:'v_1',sessionId:'s_1',timestamp:now.toISOString(),data:{}};
test('SDK clients may omit environment entirely; backend classifies behavior as production',()=>{
 assert.equal(normalizeEvent(base,'project_a',now).environment,'production');
 assert.equal(normalizeEvent({...base,environment:'demo'},'project_a',now).environment,'production');
});
test('legacy purchase labels are not excluded from tracked order counts',()=>{
 const rows=buildSessions([{sessionId:'s1',event:'purchase',properties:{environment:'demo',orderId:'o1',currency:'USD',total:19}},{sessionId:'s2',event:'purchase',properties:{environment:'production',orderId:'o2',currency:'USD',total:8}}]);
 assert.equal(rows.productionPurchases,2);
 assert.equal(rows.rows.reduce((n,r)=>n+r.revenue,0),27);
});
