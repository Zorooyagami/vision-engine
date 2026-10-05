// vision-engine/server.js
require('dotenv').config()

const express = require('express')
const cors = require('cors')
const { connectMongo } = require('./config/mongo')

const requireProject = require('./middleware/requireProject').requireProject

const app = express()
app.set('trust proxy', true)

app.use(
  cors({
    origin: true, // reflect request origin; per-project origin checks happen in checkOrigin
    allowedHeaders: ['Content-Type', 'X-Project-Id', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
)

// Session-replay ingest sends a binary (zlib) body and parses it with
// express.raw() inside the router, so it must be mounted BEFORE express.json().
app.use('/api/record', require('./routes/record'))

app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.use('/api/auth', require('./routes/auth'))
app.use('/api/events', require('./routes/events'))
app.use('/api/analytics', require('./routes/analytics'))
app.use('/api/stats', require('./routes/stats'))
app.use('/api/admin', require('./routes/admin'))

// Explore: funnels must be mounted before the generic /api/explore router.
app.use('/api/explore/funnels', requireProject, require('./routes/funnels'))
app.use('/api/explore', requireProject, require('./routes/exploreUsers'))

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
