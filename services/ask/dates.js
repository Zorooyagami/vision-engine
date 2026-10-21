const { error } = require('./catalog');
const DAY = 86400000;
function timezone(value = 'UTC') {
  if (typeof value !== 'string' || value.length > 80) throw error('Invalid timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); } catch { throw error('Invalid timezone'); }
  return value;
}
function parts(date, zone) {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(values.filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
}
function localDate(date, zone) { const p = parts(date, zone); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; }
function shiftDate(date, days) { return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10); }
function instant(date, zone, time = {}) {
  const [y, m, d] = date.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, time.hour || 0, time.minute || 0, time.second || 0);
  let value = target;
  for (let i = 0; i < 5; i++) { const p = parts(new Date(value), zone); const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - value; const next = target - offset; if (next === value) return new Date(value); value = next; }
  return new Date(value);
}
function resolveScope(plan, base, zone, now = new Date()) {
  zone = timezone(zone); const today = localDate(now, zone); const p = parts(now, zone);
  let start = new Date(base.start), end = new Date(base.end), previousStart, previousEnd, comparisonLabel = 'Previous equal-duration period';
  const monthStart = `${p.year}-${String(p.month).padStart(2, '0')}-01`;
  if (plan.period === 'today') { start = instant(today, zone); end = now; previousStart = instant(shiftDate(today, -1), zone); previousEnd = instant(shiftDate(today, -1), zone, p); comparisonLabel = 'Yesterday, through the same local time'; }
  if (plan.period === 'yesterday') { start = instant(shiftDate(today, -1), zone); end = instant(today, zone); previousStart = instant(shiftDate(today, -2), zone); previousEnd = start; comparisonLabel = 'Previous calendar day'; }
  if (plan.period === 'this_week' || plan.period === 'last_week') {
    const weekday = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7;
    const monday = shiftDate(today, -weekday);
    if (plan.period === 'this_week') { start = instant(monday, zone); end = now; previousStart = instant(shiftDate(monday, -7), zone); previousEnd = instant(shiftDate(today, -7), zone, p); comparisonLabel = 'Last week, same weekdays and elapsed local time'; }
    else { start = instant(shiftDate(monday, -7), zone); end = instant(monday, zone); previousStart = instant(shiftDate(monday, -14), zone); previousEnd = start; comparisonLabel = 'Previous full calendar week'; }
  }
  if (plan.period === 'this_month') {
    start = instant(monthStart, zone); end = now;
    const priorLast = shiftDate(monthStart, -1), priorFirst = priorLast.slice(0, 8) + '01';
    previousStart = instant(priorFirst, zone);
    const lastDay = Number(priorLast.slice(-2));
    previousEnd = p.day <= lastDay ? instant(priorFirst.slice(0, 8) + String(p.day).padStart(2, '0'), zone, p) : instant(monthStart, zone);
    comparisonLabel = 'Previous month through the matching day/time (capped at month end)';
  }
  if (plan.period === 'last_month') { end = instant(monthStart, zone); start = instant(shiftDate(monthStart, -1).slice(0, 8) + '01', zone); }
  if (plan.period === 'last_days') { start = new Date(+now - plan.days * DAY); end = now; }
  if (plan.period === 'custom') { start = instant(plan.from, zone); end = instant(shiftDate(plan.to, 1), zone); }
  if (end > now) end = now;
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start >= end) throw error('The reporting range must include elapsed time, not only future dates');
  if (end - start > 181 * DAY) throw error('Choose a reporting period of at most 180 days');
  previousStart ||= new Date(+start - (end - start)); previousEnd ||= start;
  const notices = [];
  let devices = plan.devices === null ? (base.device ? [base.device] : []) : plan.devices;
  let platform = plan.platform || base.platform;
  // An explicit device question takes precedence over an inherited platform.
  if (plan.devices !== null && plan.platform === null && ((platform === 'web' && devices.some(x => x !== 'Desktop')) || (platform === 'app' && devices.includes('Desktop')) || !devices.length)) { platform = 'combined'; notices.push('The question’s device selection overrides the inherited platform filter for this answer.'); }
  if ((platform === 'web' && devices.some(x => x !== 'Desktop')) || (platform === 'app' && devices.includes('Desktop'))) throw error('The requested platform and device conflict. Use combined platform to compare devices.');
  if (Math.abs((end - start) - (previousEnd - previousStart)) > 60000) notices.push('Calendar/timezone boundaries give these periods different elapsed durations; compare rates with care.');
  return { projectId: String(base.projectId), start, end, previousStart, previousEnd, timezone: zone, platform, devices, personas: plan.personas === null ? base.personas : plan.personas, comparisonLabel, notices };
}
module.exports = { timezone, parts, localDate, shiftDate, instant, resolveScope };
