const { getEventCatalog, toggleEventStatus, addEventDefinition } = require('../services/eventCatalog');
const { getEventDetail } = require('../services/eventDetail');

async function getEventDetailHandler(req, res) {
  try {
    const { period, platform, device, from, to } = req.query;
    const detail = await getEventDetail({
      projectId: req.projectId,
      eventName: req.params.name,
      period: period || '30d',
      customRange: from && to ? { from, to } : null,
      platform: platform || 'combined',
      device: device || null,
    });
    res.json(detail);
  } catch (err) {
    console.error('[events] detail failed', err);
    res.status(500).json({ error: 'Failed to load event detail' });
  }
}

async function getEvents(req, res) {
  try {
    const { period, platform, device, personas, from, to } = req.query;
    const events = await getEventCatalog({
      projectId: req.projectId,
      period: period || '30d',
      customRange: from && to ? { from, to } : null,
      personas: personas ? personas.split(',').filter(Boolean) : [],
      platform: platform || 'combined',
      device: device || null,
    });
    res.json({ events });
  } catch (err) {
    console.error('[events] failed', err);
    res.status(500).json({ error: 'Failed to load events' });
  }
}

async function patchEventStatus(req, res) {
  try {
    const updated = await toggleEventStatus(req.projectId, req.params.name);
    if (!updated) return res.status(404).json({ error: 'Event not found' });
    res.json({ name: updated.name, status: updated.status });
  } catch (err) {
    console.error('[events] status toggle failed', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
}

async function postEvent(req, res) {
  try {
    const created = await addEventDefinition(req.projectId, req.body);
    res.status(201).json({ event: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { getEvents, patchEventStatus, postEvent, getEventDetailHandler };
