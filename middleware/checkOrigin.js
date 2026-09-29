function checkOrigin(req, res, next) {
  // Browser SDK requests should carry Origin. Referer is kept only as a
  // fallback for environments that omit Origin.
  const rawOrigin = req.headers.origin || req.headers.referer;

  if (!rawOrigin) {
    return res.status(403).json({ error: 'Missing Origin header' });
  }

  let origin;
  try {
    origin = new URL(rawOrigin).origin;
  } catch {
    return res.status(403).json({ error: 'Invalid Origin header' });
  }

  const allowed = Array.isArray(req.project?.allowedOrigins)
    ? req.project.allowedOrigins
    : [];

  if (!allowed.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed for this project' });
  }

  next();
}

module.exports = { checkOrigin };
