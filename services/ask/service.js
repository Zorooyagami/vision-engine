const { error } = require('./catalog');
const { planQuestion, validatePlan } = require('./planner');
const { resolveScope, timezone } = require('./dates');
const { buildAnswer } = require('./answer');
function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error('Provide a question');
  if (typeof body.question !== 'string' || body.question.trim().length < 3 || body.question.length > 1000) throw error('Use a question of 3–1000 characters');
  if (body.context && JSON.stringify(body.context).length > 6000) throw error('Question context is too large');
  return { question: body.question.trim(), context: body.context ? validatePlan(body.context) : null, timezone: timezone(body.timezone || 'UTC') };
}
async function answerQuestion(body, base, { load, planner = planQuestion, now = new Date(), isCancelled = () => false } = {}) {
  const request = validateRequest(body);
  const routing = await planner(request.question, request.context);
  if (isCancelled()) throw error('Request cancelled', 499);
  const plan = validatePlan(routing.plan);
  if (plan.status !== 'ready') return { version: 2, status: plan.status, headline: plan.status === 'clarify' ? 'Let’s narrow the question' : 'This question needs other data', observations: [plan.message || 'Try a question about revenue, sessions, checkout conversion or a tracked funnel.'], cards: [], blocks: [], warnings: [], notes: [], definitions: [], followUps: ['Why did checkout conversion change for mobile this week?', 'Show revenue by persona', 'Show daily sessions for the last 30 days'], context: request.context, mode: routing.mode, notice: routing.notice || null };
  const scope = resolveScope(plan, base, request.timezone, now);
  const raw = await load(scope, plan.compare !== 'none');
  if (isCancelled()) throw error('Request cancelled', 499);
  return buildAnswer(plan, scope, raw, routing);
}
module.exports = { validateRequest, answerQuestion };
