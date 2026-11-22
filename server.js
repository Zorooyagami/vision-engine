// vision-engine/server.js
require('dotenv').config()

const express = require('express')
const cors = require('cors')
const compression = require('compression')
const { connectMongo } = require('./config/mongo')

const requireProject = require('./middleware/requireProject').requireProject

const app = express()
app.set('trust proxy', true)


const corsOptions = {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Project-Id',
  ],
  optionsSuccessStatus: 204,
};

// Must be registered before all routes
app.use(cors(corsOptions))
// gzip JSON responses (heatmaps/analytics payloads shrink ~5-10x). Skip the
// live SSE stream, which must not be buffered.
app.use(compression({
  threshold: 1024,
  filter: (req, res) => (String(res.getHeader('Content-Type') || '').includes('text/event-stream') ? false : compression.filter(req, res)),
}))
// app.options('*', cors(corsOptions))
// Session-replay ingest sends a binary (zlib) body and parses it with
// express.raw() inside the router, so it must be mounted BEFORE express.json().
app.use('/api/record', require('./routes/record'))

// Per-request timing: logs slow requests and exposes the time to the browser
// (Network tab -> request -> Timing / "Server-Timing" header).
app.use((req, res, next) => {
  const start = process.hrtime.bigint()
  const origWriteHead = res.writeHead
  res.writeHead = function (...args) {
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${ms.toFixed(1)}`)
    return origWriteHead.apply(this, args)
  }
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    if (ms > 500) console.warn(`[slow] ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(0)}ms`)
  })
  next()
})

app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

// Measures server -> MongoDB round-trip time. If "avgPingMs" is high (e.g. >50),
// the server and database are far apart; if it is low, the slowness is in the
// queries or the network between the browser and the server.
app.get('/health/db', async (_req, res) => {
  try {
    const mongoose = require('mongoose')
    const admin = mongoose.connection.db.admin()
    const times = []
    for (let i = 0; i < 5; i += 1) {
      const t = process.hrtime.bigint()
      await admin.ping()
      times.push(Number(process.hrtime.bigint() - t) / 1e6)
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    res.json({
      avgPingMs: Math.round(avg),
      pingsMs: times.map((t) => Math.round(t)),
      host: mongoose.connection.host,
      railwayRegion: process.env.RAILWAY_REPLICA_REGION || process.env.RAILWAY_REGION || null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.use('/api/auth', require('./routes/auth'))
app.use('/api/behavior', require('./routes/behavior'))
app.use('/api/events', require('./routes/events'))
app.use('/api/analytics', require('./routes/analytics'))
app.use('/api/opportunities', require('./routes/opportunities'))
app.use('/api/decision-intelligence', require('./routes/decisionIntelligence'))
app.use('/api/stats', require('./routes/stats'))
app.use('/api/admin', require('./routes/admin'))

// Explore: funnels must be mounted before the generic /api/explore router.
app.use('/api/explore/funnels', requireProject, require('./routes/funnels'))
app.use('/api/explore/query-builder', requireProject, require('./routes/queryBuilder'))
app.use('/api/explore', requireProject, require('./routes/exploreUsers'))
app.use('/api/intelligence', require('./routes/intelligence'))
app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` }))

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

const PORT = process.env.PORT || 4000

connectMongo().then(() => {
  app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`))
})
