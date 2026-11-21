const Event = require('../models/Event');
const { resolveDateRange } = require('./filterHelpers');

const clean = (value) => typeof value === 'string' ? value.trim() : '';
const label = (value, fallback = 'Unknown') => clean(value) || fallback;
const sortRows = (map, limit = 12) => [...map.entries()]
  .map(([name, sessions]) => ({ name, sessions: sessions.size }))
  .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
  .slice(0, limit);

// City centres for the ten named locations used by the isolated DevDay seeder.
// Fallback positions are approximate and never presented as measured IP coordinates.
const CITY_CENTRES = Object.freeze({
  'IN|mumbai':[19.076,72.8777], 'IN|delhi':[28.6139,77.209],
  'IN|bengaluru':[12.9716,77.5946], 'IN|pune':[18.5204,73.8567],
  'IN|hyderabad':[17.385,78.4867], 'GB|london':[51.5074,-0.1278],
  'US|new york':[40.7128,-74.006], 'AE|dubai':[25.2048,55.2708],
  'SG|singapore':[1.3521,103.8198], 'DE|berlin':[52.52,13.405],
});
function inferredCityCentre(countryCode, city) {
  return CITY_CENTRES[`${clean(countryCode).toUpperCase()}|${clean(city).toLowerCase()}`] || null;
}

async function getAudienceIntelligence(req, res) {
  try {
    const period = req.query.period || '30d';
    const customRange = period === 'custom' ? { from: req.query.from, to: req.query.to } : null;
    const { start, end } = resolveDateRange(period, customRange);
    const match = { projectId: req.projectId, timestamp: { $gte: start, $lt: end }, event: { $nin: ['heatmap_move', 'heatmap_click', 'heatmap_scroll'] } };
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
      // Treat a captured coordinate as one atomic lat/long pair; otherwise an
      // earlier city-centre fallback could accidentally be mixed with a real
      // latitude from a later event in the same session.
      const hasCapturedPair = geo.latitude != null && geo.latitude !== '' &&
        geo.longitude != null && geo.longitude !== '' &&
        Number.isFinite(Number(geo.latitude)) && Number.isFinite(Number(geo.longitude)) &&
        Math.abs(Number(geo.latitude)) <= 90 && Math.abs(Number(geo.longitude)) <= 180;
      if (hasCapturedPair && (current.locationSource !== 'captured-geo' ||
          !Number.isFinite(current.latitude) || !Number.isFinite(current.longitude))) {
        current.latitude = Number(geo.latitude);
        current.longitude = Number(geo.longitude);
        current.locationSource = 'captured-geo';
      }
      if (!Number.isFinite(current.latitude) || !Number.isFinite(current.longitude)) {
        const centre = inferredCityCentre(current.countryCode, current.city);
        if (centre) { [current.latitude, current.longitude] = centre; current.locationSource = 'city-centre-fallback'; }
      }
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
      const key = `${row.countryCode || row.country || 'Unknown'}|${row.city || 'Unknown'}|${row.locationSource || 'captured'}|${row.latitude.toFixed(2)}|${row.longitude.toFixed(2)}`;
      if (!locations.has(key)) locations.set(key, { city: row.city || 'Unknown', region: row.region || '', country: row.country || 'Unknown', countryCode: row.countryCode || '', latitude: row.latitude, longitude: row.longitude, locationSource:row.locationSource || 'captured-geo', sessions: new Set() });
      locations.get(key).sessions.add(row.sessionId);
    }
    const locationRows = [...locations.values()].map((item) => ({ ...item, sessions: item.sessions.size }))
      .sort((a, b) => b.sessions - a.sessions).slice(0, 250);
    const countries = group('country', 500).filter((item) => item.name !== 'Unknown');
    const cities = group('city', 1000).filter((item) => item.name !== 'Unknown');
    const locatedSessions = new Set(geoRows.map((row) => row.sessionId)).size;
    const estimatedCitySessions = geoRows.filter(row => row.locationSource === 'city-centre-fallback').length;
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
      estimatedCitySessions,
      coverage: { eventsScanned: events.length, capped: events.length >= 100000, sessionsScanned: rows.length },
    });
  } catch (err) {
    console.error('[analytics/audience] failed:', err);
    res.status(400).json({ error: err.message || 'Could not load device and geographic analytics.' });
  }
}

module.exports = { getAudienceIntelligence };
