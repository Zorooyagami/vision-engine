const { getRange } = require('./insightWindows');
const { personaMetricsForWindow, genericMetricsForWindow } = require('./aggregations');

async function buildFactsForWindow(days) {
  const { start, end, prevStart, prevEnd } = getRange(days);

  const [personaCurrent, personaPrevious, genericCurrent, genericPrevious] = await Promise.all([
    personaMetricsForWindow(start, end),
    personaMetricsForWindow(prevStart, prevEnd),
    genericMetricsForWindow(start, end),
    genericMetricsForWindow(prevStart, prevEnd),
  ]);

  return {
    windowDays: days,
    personas: { current: personaCurrent, previous: personaPrevious },
    generic: { current: genericCurrent, previous: genericPrevious },
  };
}

module.exports = { buildFactsForWindow };