// server/models/Session.js
const mongoose = require('mongoose')

const chunkSchema = new mongoose.Schema(
  {
    page: { type: String, required: true },
    data: { type: Buffer, required: true }, // compressed rrweb event chunk
    receivedAt: { type: Date, default: Date.now },
  },
  { _id: false }
)

const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    chunks: { type: [chunkSchema], default: [] },
  },
  { timestamps: true } // gives you createdAt / updatedAt automatically
)

module.exports = mongoose.model('Session', sessionSchema)