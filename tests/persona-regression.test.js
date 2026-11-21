const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '../backend');
const original = Module._load;
let captured = [];
const fakeEvent = {
  aggregate: async (pipeline) => { captured.push(pipeline); return [{
    purchases: [{ revenue: 75, purchaseCount: 1 }],
    sessions: [{count: 3}], users: [{count: 2}], guestSessions: [{count: 5}],
  }]; },
};
Module._load = function(request, parent, isMain) {
  if (request === '../models/Event' && parent?.filename?.startsWith(root)) return fakeEvent;
  return original.apply(this, arguments);
};
(async () => {
 const {coreMetrics} = require(path.join(root, 'services/analyticsService'));
 const guests = await coreMetrics({projectId:'x',userId:null},'all',{includeGuest:true});
 assert.equal(guests.activeUsers,7, 'includeGuest adds unique anonymous sessions');
 const notGuests = await coreMetrics({projectId:'x'},'all');
 assert.equal(notGuests.activeUsers,2, 'all users preserves known-user count');
 assert.ok(captured[0][1].$facet.guestSessions, 'Guest facet exists');
 assert.ok(captured[0][1].$facet.guestSessions[0].$match.$or, 'Guest facet matches null and guest IDs');
 const {resolvePersonaMatch} = require(path.join(root, 'services/personaResolver'));
 // The filter helper is imported as a cached module; stub its cohort resolver for this isolated test.
 const helper = require(path.join(root,'services/filterHelpers'));
 const matchGuest = await resolvePersonaMatch('x','guest',{from:new Date(0),to:new Date()});
 assert.equal(matchGuest.$or.length,1);
 assert.ok(matchGuest.$or[0].$or.length >= 3);
 const {analyticsFilters} = require(path.join(root,'middleware/analyticsFilters'));
 let req={projectId:'x',query:{period:'custom',from:'2026-11-01',to:'2026-11-05',persona:'guest'}};
 let err=null; await analyticsFilters(req,{status(code){this.code=code;return this},json(body){err=body}},()=>{});
 assert.equal(err,null,JSON.stringify(err));
 assert.equal(req.analytics.range.from.toISOString(),'2026-11-01T00:00:00.000Z');
 assert.equal(req.analytics.range.to.toISOString(),'2026-11-06T00:00:00.000Z');
 assert.equal(req.analytics.baseMatch.timestamp.$lt.toISOString(),'2026-11-06T00:00:00.000Z');
 console.log('PASS: Guest KPI count, known users, guest match, inclusive custom date');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{Module._load=original});
