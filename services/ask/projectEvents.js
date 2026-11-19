const EventDefinition = require('../../models/EventDefinition');
const { BUILT_INS } = require('./queryCompiler');
async function listProjectEvents(projectId) {
  const definitions = await EventDefinition.find({ projectId, status: 'Active' })
    .select('name description trigger.properties.key').limit(150).lean();
  return definitions.filter(x => x.name && /^[\w .:-]{1,100}$/.test(x.name)).map(x => ({ name: x.name, description: String(x.description || '').slice(0, 120), propertyKeys: (x.trigger?.properties || []).map(p => p.key).filter(k => /^[a-zA-Z][\w]{0,59}$/.test(k)).slice(0, 12) }));
}
module.exports = { listProjectEvents };
