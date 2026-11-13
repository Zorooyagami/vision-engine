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

  const names=String(persona).split(',').map(p=>p==='firstTime'?'firsttime':p).filter(Boolean);
  const filter=await getPersonaUserIds(projectId,names,range?.from||new Date(0),range?.to||new Date());
  return require('./filterHelpers').applyPersonaFilter({},filter);

}

module.exports = { resolvePersonaMatch };
