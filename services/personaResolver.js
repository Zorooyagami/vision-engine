const { getPersonaUserIds } = require('./filterHelpers');

/**
 * Build a Mongo userId predicate for the legacy analytics middleware while
 * keeping persona definitions identical to the rest of the application.
 *
 * Priority is mutually exclusive:
 *   loyal (2+ lifetime purchases) > firsttime (signup in window)
 *   > active (known user active in window) > guest (anonymous)
 */
async function resolvePersonaMatch(projectId, persona, range) {
  if (!projectId) throw new Error('projectId is required');
  if (!persona || persona === 'all') return {};
  if (persona === 'guest') return { userId: null };

  const normalized = persona === 'firstTime' ? 'firsttime' : persona;
  if (!['loyal', 'firsttime', 'active'].includes(normalized)) return {};

  const now = new Date();
  const start = range?.from || new Date(0);
  const end = range?.to || now;
  const personaFilter = await getPersonaUserIds(projectId, [normalized], start, end);
  const ids = [...(personaFilter?.ids || [])];

  // An impossible sentinel keeps the predicate explicit and avoids accidentally
  // dropping the persona filter when no users match.
  return { userId: { $in: ids.length ? ids : ['__no_match__'] } };
}

module.exports = { resolvePersonaMatch };
