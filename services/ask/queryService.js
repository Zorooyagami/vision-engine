const Event = require('../../models/Event');
const { buildPipeline } = require('./queryCompiler');
const { error } = require('./catalog');
const { listProjectEvents } = require('./projectEvents');
function scopeJSON(scope) { return { ...scope, start: scope.start.toISOString(), end: scope.end.toISOString(), previousStart: scope.previousStart.toISOString(), previousEnd: scope.previousEnd.toISOString() }; }
async function answerAggregateQuery(plan, scope, routing, { signal, runAggregate, catalog } = {}) {
  if (scope.personas?.length) return { status: 'clarify', headline: 'Choose an audience scope', observations: ['Persona-filtered aggregation needs a user-level summary. Clear the persona filter or use a 30-day detailed question.'], cards: [], blocks: [], warnings: [], notes: [], definitions: [], followUps: [], context: plan };
  if (signal?.aborted) throw error('Request cancelled', 499);
  const known = catalog || await listProjectEvents(scope.projectId);
  const knownNames = known.map(x => x.name);
  const pipeline = buildPipeline(plan.query, scope, knownNames, plan);
  const execute = runAggregate || (async stages => Event.aggregate(stages).allowDiskUse(true).option({ maxTimeMS: 45000, ...(signal ? { signal } : {}) }).exec());
  const rows = runAggregate ? await execute(pipeline) : (await require('./rollupReader').tryRollup(plan.query, scope, knownNames, plan, signal)) ?? await execute(pipeline);
  if (signal?.aborted) throw error('Request cancelled', 499);
  const label = { count_events: 'Recorded events', distinct_users: 'Identified users', count_sessions: 'Sessions', sum_purchase_total: 'Purchase amount', first_seen: 'First recorded activity', last_seen: 'Last recorded activity' }[plan.query.measure];
  const warnings = [];
  const currencies = new Set(rows.map(r => r._id?.currency).filter(Boolean));
  if (plan.query.measure === 'sum_purchase_total' && currencies.size > 1) return { version: 2, status: 'clarify', headline: 'Multiple recorded currencies', observations: ['Choose a single currency before ranking or summing purchase amounts. Currency conversion is not performed.'], cards: [], blocks: [], warnings: [], notes: [], definitions: [], followUps: [], context: plan, plan, scope: scopeJSON(scope) };
  if (plan.query.measure === 'sum_purchase_total') warnings.push('Only purchase events with valid numeric totals and a specified currency are included. Duplicate order events and refunds are not reconciled; verify data quality before treating this as financial revenue.');
  if (plan.query.measure === 'distinct_users') warnings.push('Anonymous visitors without a user ID are excluded. Identified users can appear in multiple groups.');
  if (plan.period === 'all_time') warnings.push('Lifetime means all events recorded since SDK installation.');
  return { version: 2, status: rows.length ? 'ready' : 'empty', headline: rows.length ? `${label} by ${plan.query.groupBy.replaceAll('_', ' ')}` : 'No matching recorded events', observations: [rows.length ? `${rows.length} group(s) were found in the selected period.` : 'No matching event records were found. Check the project and event name.'], cards: [], blocks: [{ type: 'analyticsTable', title: label, columns: ['Group', label], rows: rows.map(r => { const key = typeof r._id === 'object' && r._id !== null ? `${r._id.group ?? 'All'} (${r._id.currency})` : String(r._id ?? 'All'); return [key, r.value instanceof Date ? r.value.toISOString() : r.value]; }) }], warnings, notes: ['Aggregated in MongoDB using a validated, server-owned pipeline; raw customer events were not sent to the planner.'], definitions: [], followUps: [], scope: scopeJSON(scope), plan, context: plan, mode: routing.mode, notice: routing.notice || null, generatedAt: new Date().toISOString() };
}
module.exports = { answerAggregateQuery };
