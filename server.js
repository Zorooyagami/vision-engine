/**
 * Vision Backend — Entry Point
 * -----------------------------
 * Boots the Express server, connects to MongoDB, and wires up the
 * route groups:
 *   /api/events -> receiving data FROM the tracker SDK
 *   /api/stats  -> serving computed stats TO the dashboard
 *   /api/auth   -> basic signup/login (see controllers/authController.js
 *                  for the deliberate "not production-grade" tradeoffs)
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { connectMongo } = require("./config/mongo");

const eventsRoutes = require("./routes/events");
const statsRoutes = require("./routes/stats");
const authRoutes = require("./routes/auth");
const recordRouter = require("./routes/record");

const app = express();
const PORT = process.env.PORT || 4000;

// Render (and most hosting platforms) put your app behind a reverse
// proxy/load balancer. Without this, req.ip / req.secure and anything
// relying on X-Forwarded-* headers will be wrong in production.
app.set("trust proxy", 1);

// --- CORS ---
// ALLOWED_ORIGINS is a comma-separated list, e.g.:
//   ALLOWED_ORIGINS=https://your-dashboard.onrender.com,https://your-demo-site.onrender.com
// Falls back to common local dev ports if not set, so nothing breaks locally.
const allowedOrigins = 'http://localhost:5173'
// const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5174,http://localhost:3000,http://localhost:5173/")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow tools like curl/Postman (no Origin header) and any origin
      // explicitly listed in ALLOWED_ORIGINS.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.warn(`[cors] blocked request from origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// --- Middleware ---
app.use(express.json({ limit: "1mb" })); // parse JSON bodies; batched events can add up
app.use(morgan("dev")); // simple request logging in the terminal — helpful while debugging

// --- Routes ---
app.get("/", (req, res) => {
  res.json({ service: "vision-backend", status: "running" });
});

app.use("/api/events", eventsRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/auth", authRoutes);
app.use('/api/record', recordRouter)
// Basic health check — useful to confirm the server + DB connections are alive
app.get("/health", (req, res) => {
  res.json({ status: "ok!!!" });
});

// --- Startup sequence ---
async function start() {
  // MongoDB is required — the app can't do anything useful without it,
  // so connectMongo() intentionally exits the process on failure
  // (see config/mongo.js).
  await connectMongo();

  app.listen(PORT, () => {
    console.log(`[server] Vision backend running on port ${PORT}`);
  });
}

start();
