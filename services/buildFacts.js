const { getRange } = require('./insightWindows');
const { personaMetricsForWindow, genericMetricsForWindow } = require('./aggregations');

async function buildFactsForWindow(projectId, days) {
  const { start, end, prevStart, prevEnd } = getRange(days);
  const [personaCurrent, personaPrevious, genericCurrent, genericPrevious] = await Promise.all([
    personaMetricsForWindow(projectId, start, end),
    personaMetricsForWindow(projectId, prevStart, prevEnd),
    genericMetricsForWindow(projectId, start, end),
    genericMetricsForWindow(projectId, prevStart, prevEnd),
  ]);

  return {
    projectId,
    windowDays: days,
    personas: { current: personaCurrent, previous: personaPrevious },
    generic: { current: genericCurrent, previous: genericPrevious },
  };
}

module.exports = { buildFactsForWindow };
