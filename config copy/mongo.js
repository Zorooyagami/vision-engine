const mongoose = require('mongoose');

async function connectMongo() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/vision';

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
    });
    // Never log the full URI: Atlas connection strings commonly contain credentials.
    console.log('[mongo] connected');
  } catch (err) {
    console.error('[mongo] connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = { connectMongo };
