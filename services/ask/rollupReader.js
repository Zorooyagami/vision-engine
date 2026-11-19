'use strict';
// Opt-in rollup reads for event counts; only returns values after verifying
// every full UTC day has a completed materialization checkpoint.
const mongoose = require('mongoose');
const { buildPipeline } = require('./queryCompiler');
const DAY = 86400000;
const floorDay = time => Math.floor(time / DAY) * DAY;
const ceilDay = time => Math.ceil(time / DAY) * DAY;
function keyOf(row, dimension) { return dimension === 'none' ? 'All' : dimension === 'day' ? row.day : dimension === 'event' ? row.event : dimension === 'device' ? row.device : row.source; }
async function tryRollup(spec, scope, catalog, plan, signal) {
  if (spec.measure !== 'count_events' || ['hour_of_day','product','user'].includes(spec.groupBy) || (spec.groupBy === 'day' && scope.timezone !== 'UTC') || scope.personas?.length) return null;
  const first = ceilDay(+scope.start), last = floorDay(+scope.end);
  if (last <= first) return null;
  const days = (last - first) / DAY;
  if (days < 2 || days > 730) return null;
  const db = mongoose.connection.db;
  const startDay = new Date(first).toISOString().slice(0,10);
  const endDay = new Date(last).toISOString().slice(0,10);
  const progress = await db.collection('daily_rollup_progress').countDocuments({ projectId: scope.projectId, day: { $gte: startDay, $lt: endDay }, state: 'complete' });
  if (progress !== days) return null;
  if (signal?.aborted) throw Object.assign(new Error('Request cancelled'),{status:499});
  const match = { projectId: scope.projectId, day: { $gte: startDay, $lt: endDay } };
  if (spec.eventName) match.event = spec.eventName;
  if (scope.devices?.length) match.device = { $in: scope.devices };
  if (scope.platform === 'web') match.device = 'Desktop';
  if (scope.platform === 'app') match.device = { $in: ['Mobile', 'Tablet'] };
  const dim = ({none:null,day:'$day',event:'$event',device:'$device',source:'$source'})[spec.groupBy];
  const rollups = await db.collection('daily_event_rollups').aggregate([
    {$match:match},{$group:{_id:dim,value:{$sum:'$events'}}}
  ],{allowDiskUse:true,maxTimeMS:45000,signal}).toArray();
  const counts = new Map(rollups.map(r=>[String(r._id??'All'),r.value]));
  // Edge slices are small (<24 hours each) and are read from raw events.
  const edges = [[+scope.start,first],[last,+scope.end]].filter(([a,b])=>a<b);
  for (const [start,end] of edges) {
    if (signal?.aborted) throw Object.assign(new Error('Request cancelled'),{status:499});
    const edgeScope = {...scope,start:new Date(start),end:new Date(end)};
    const rawRows = await mongoose.model('Event').aggregate(buildPipeline(spec,edgeScope,catalog, {internalEdge:true,sort:plan.sort})).allowDiskUse(true).option({maxTimeMS:45000,signal}).exec();
    if (rawRows.length > 5000) throw Object.assign(new Error('Partial-day aggregation has too many distinct groups; refine this question.'),{status:413});
    for (const row of rawRows) {const key=String(row._id??'All'); counts.set(key,(counts.get(key)||0)+row.value);}
  }
  const rows = [...counts].map(([key,value])=>({_id:key==='All'?null:key,value}));
  rows.sort(spec.groupBy==='day' ? (a,b)=>String(a._id).localeCompare(String(b._id)) : (a,b)=>(plan.sort==='asc'?1:-1)*(a.value-b.value));
  return rows.slice(0, spec.groupBy==='day'?365:spec.groupBy==='hour_of_day'?24:plan.limit);
}
module.exports={tryRollup};
