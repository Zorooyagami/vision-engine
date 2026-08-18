const mongoose = require('mongoose')
const Event = require('./models/Event')

const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://mongo:27017/easyshop'

async function showEventSummary() {
  try {
    await mongoose.connect(MONGO_URI)

    const summary = await Event.aggregate([
      {
        $group: {
          _id: '$event',
          count: { $sum: 1 }
        }
      },
      {
        $sort: {
          count: -1
        }
      }
    ])

    console.table(summary)

  } catch (error) {
    console.error('Error:', error)
  } finally {
    await mongoose.disconnect()
  }
}
module.exports = { showEventSummary };