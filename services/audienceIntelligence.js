const Event = require('../models/Event');
const { resolveDateRange } = require('./filterHelpers');

const clean = (value) => typeof value === 'string' ? value.trim() : '';
const label = (value, fallback = 'Unknown') => clean(value) || fallback;
const sortRows = (map, limit = 12) => [...map.entries()]
  .map(([name, sessions]) => ({ name, sessions: sessions.size }))
  .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
  .slice(0, limit);

async function getAudienceIntelligence(req, res) {
  try {
    const period = req.query.period || '30d';
    const customRange = period === 'custom' ? { from: req.query.from, to: req.query.to } : null;
    const { start, end } = resolveDateRange(period, customRange);
    const match = { projectId: req.projectId, timestamp: { $gte: start, $lt: end } };
    const events = await Event.find(match)
      .select({ sessionId: 1, timestamp: 1, deviceInfo: 1, browser: 1, ip: 1, event: 1 })
      .sort({ timestamp: -1 })
      .limit(100000)
      .lean();

    // Aggregate by session, not raw event count. High-frequency events such as
    // heatmap_move should not make one visitor appear to be hundreds of visitors.
    const sessions = new Map();
    for (const event of events) {
      const sessionId = clean(event.sessionId);
      if (!sessionId) continue;
      const info = event.deviceInfo || {};
      const geo = info.geo || {};
      const current = sessions.get(sessionId) || { sessionId, timestamp: event.timestamp };
      if (!current.os && (info.os || info.platform)) current.os = label(info.os || info.platform);
      if (!current.browser && (info.browser || event.browser)) current.browser = label(info.browser || event.browser);
      if (!current.deviceType && info.deviceType) current.deviceType = label(info.deviceType);
      if (!current.platform && info.platform) current.platform = label(info.platform);
      if (!current.language && info.language) current.language = label(info.language);
      if (!current.timezone && (typeof geo.timezone === 'string' ? geo.timezone : geo.timezone?.id || info.timezone)) current.timezone = label(typeof geo.timezone === 'string' ? geo.timezone : geo.timezone?.id || info.timezone);
      if (!current.country && geo.country) current.country = label(geo.country);
      if (!current.countryCode && geo.countryCode) current.countryCode = label(geo.countryCode);
      if (!current.region && geo.region) current.region = label(geo.region);
      if (!current.city && geo.city) current.city = label(geo.city);
      if (!Number.isFinite(current.latitude) && Number.isFinite(Number(geo.latitude)) && geo.latitude !== '' && geo.latitude != null) current.latitude = Number(geo.latitude);
      if (!Number.isFinite(current.longitude) && Number.isFinite(Number(geo.longitude)) && geo.longitude !== '' && geo.longitude != null) current.longitude = Number(geo.longitude);
      sessions.set(sessionId, current);
    }

    const rows = [...sessions.values()];
    const group = (field, limit = 12) => {
      const map = new Map();
      for (const session of rows) {
        const name = label(session[field]);
        if (!map.has(name)) map.set(name, new Set());
        map.get(name).add(session.sessionId);
      }
      return sortRows(map, limit);
    };
    const geoRows = rows.filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && Math.abs(row.latitude) <= 90 && Math.abs(row.longitude) <= 180);
    const locations = new Map();
    for (const row of geoRows) {
      const key = `${row.country || 'Unknown'}|${row.city || 'Unknown'}|${row.latitude.toFixed(2)}|${row.longitude.toFixed(2)}`;
      if (!locations.has(key)) locations.set(key, { city: row.city || 'Unknown', region: row.region || '', country: row.country || 'Unknown', countryCode: row.countryCode || '', latitude: row.latitude, longitude: row.longitude, sessions: new Set() });
      locations.get(key).sessions.add(row.sessionId);
    }
    const locationRows = [...locations.values()].map((item) => ({ ...item, sessions: item.sessions.size }))
      .sort((a, b) => b.sessions - a.sessions).slice(0, 250);
    const countries = group('country', 500).filter((item) => item.name !== 'Unknown');
    const cities = group('city', 1000).filter((item) => item.name !== 'Unknown');
    const locatedSessions = new Set(geoRows.map((row) => row.sessionId)).size;
    res.json({
      period,
      metrics: {
        sessions: rows.length,
        locatedSessions,
        countries: countries.length,
        cities: cities.length,
        locationCoverage: rows.length ? Math.round((locatedSessions / rows.length) * 100) : 0,
      },
      devices: group('deviceType'),
      operatingSystems: group('os'),
      browsers: group('browser'),
      platforms: group('platform'),
      languages: group('language'),
      countries,
      cities,
      locations: locationRows,
      coverage: { eventsScanned: events.length, capped: events.length >= 100000, sessionsScanned: rows.length },
    });
  } catch (err) {
    console.error('[analytics/audience] failed:', err);
    res.status(400).json({ error: err.message || 'Could not load device and geographic analytics.' });
  }
}

module.exports = { getAudienceIntelligence };
