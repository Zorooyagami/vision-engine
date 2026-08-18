/**
 * Vision Backend — Entry Point
 * -----------------------------
 * Boots the Express server, connects to MongoDB and Redis, and wires up
 * the two route groups we have so far:
 *   /api/events  -> receiving data FROM the tracker SDK
 *   /api/stats   -> serving computed stats TO the dashboard
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { connectMongo } = require("./config/mongo");
const { connectRedis } = require("./config/redis");

const eventsRoutes = require("./routes/events");
const statsRoutes = require("./routes/stats");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: "http://localhost:5174",
    credentials: true,
  })
);
// --- Middleware ---
// app.use(cors()); // allows the demo site (different port/origin) to call this API
app.use(express.json({ limit: "1mb" })); // parse JSON bodies; batched events can add up
app.use(morgan("dev")); // simple request logging in the terminal — helpful while debugging

// --- Routes ---
app.use("/api/events", eventsRoutes);
app.use("/api/stats", statsRoutes);

// Basic health check — useful to confirm the server + DB connections are alive
app.get("/health", (req, res) => {
  res.json({ status: "all ok here!!" });
});

// --- Startup sequence ---
async function start() {
  await connectMongo();
  await connectRedis();

  app.listen(PORT, () => {
    console.log(`[server] Vision backend running on http://localhost:${PORT}`);
  });
}

start();
