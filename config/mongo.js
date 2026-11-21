/**
 * MongoDB connection setup (using Mongoose).
 *
 * We're using Mongoose (not the raw MongoDB driver) because it gives us
 * light schema validation for the parts of our data that ARE consistent
 * (event name, sessionId, userId, timestamp), while still letting the
 * `properties` field stay totally flexible (Mixed type) for whatever
 * extra data each event type needs.
 */

const mongoose = require("mongoose");

async function connectMongo() {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/vision";

  try {
    await mongoose.connect(uri, {
      maxPoolSize: 20,                 // parallel queries don't queue behind each other
      minPoolSize: 2,                  // keep warm connections; avoids a TLS handshake per cold request
      serverSelectionTimeoutMS: 10000,
      compressors: 'zstd,zlib',        // compress DB<->server traffic (helps most when they are far apart)
    });
    console.log("[mongo] connected:", uri.replace(/\/\/[^@]*@/, "//***@"));
  } catch (err) {
    console.error("[mongo] connection failed:", err.message);
    process.exit(1);
  }
}

module.exports = { connectMongo };
