/**
 * Vision Backend — Entry Point
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { connectMongo } = require('./config/mongo');

const eventsRoutes = require('./routes/events');
const statsRoutes = require('./routes/stats');
const authRoutes = require('./routes/auth');
const recordRouter = require('./routes/record');
const analyticsRouter = require('./routes/analytics');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 4000;

app.set('trust proxy', 1);

const dashboardOrigins = (
  process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000'
)
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

function isPublicIngestionPath(req) {
  const path = req.originalUrl?.split('?')[0] || '';
  return (
    (req.method === 'POST' || req.method === 'OPTIONS') &&
    (path === '/api/events' || path === '/api/record/ingest')
  );
}

// The SDK can run on any customer origin, so CORS must allow the ingestion
// request to reach our project/origin validation middleware. Dashboard/read
// APIs remain restricted to ALLOWED_ORIGINS.
app.use(
  cors((req, callback) => {
    const requestOrigin = req.headers.origin;
    const publicIngestion = isPublicIngestionPath(req);

    let allowed = false;
    if (!requestOrigin) {
      allowed = true; // curl/Postman/server-to-server
    } else if (publicIngestion) {
      allowed = true; // actual request is validated by checkOrigin
    } else {
      allowed = dashboardOrigins.includes(requestOrigin.replace(/\/$/, ''));
    }

    if (!allowed) {
      console.warn(`[cors] blocked request from origin: ${requestOrigin}`);
    }

    callback(null, {
      origin: allowed,
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-Project-Id'],
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 86400,
    });
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.json({ service: 'vision-backend', status: 'running' });
});

app.use('/api/events', eventsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/record', recordRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/admin', adminRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Express' default 404 handler returns HTML ("Cannot GET/POST ..."). Keep API
// failures JSON-shaped so the shared frontend apiClient can handle them cleanly.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Keep Express errors JSON-shaped so the dashboard API client never receives
// an HTML error page for ordinary API failures.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[server] unhandled error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  await connectMongo();
  app.listen(PORT, () => {
    console.log(`[server] Vision backend running on port ${PORT}`);
  });
}

start();
