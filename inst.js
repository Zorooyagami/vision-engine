require('dotenv').config()
const crypto = require('crypto')
const mongoose = require('mongoose')
const User = require('./models/User')

function generateUserId(email) {
  const normalizedEmail = email.trim().toLowerCase()

  return crypto
    .createHash('sha256')
    .update(normalizedEmail)
    .digest('hex')
    .slice(0, 16)
}

const firstNames = [
  // Indian
  'Aarav', 'Priya', 'Vivaan', 'Ananya', 'Aditya',
  'Saanvi', 'Arjun', 'Diya', 'Reyansh', 'Aadhya',
  'Vihaan', 'Myra', 'Atharv', 'Anika', 'Kabir',
  'Ishita', 'Shaurya', 'Kiara', 'Dhruv', 'Pari',
  'Krishna', 'Aisha', 'Rudra', 'Navya', 'Ayaan',
  'Riya', 'Yash', 'Sneha', 'Rohan', 'Meera',
  'Karan', 'Pooja', 'Siddharth', 'Kavya', 'Nikhil',
  'Shreya', 'Aman', 'Tanvi', 'Harsh', 'Nisha',

  // UK
  'Oliver', 'Amelia', 'George', 'Isla', 'Harry',
  'Olivia', 'Jack', 'Emily', 'Charlie', 'Sophie',
  'Thomas', 'Grace', 'James', 'Mia', 'William',
  'Poppy', 'Noah', 'Ella', 'Joshua', 'Lily',
  'Oscar', 'Freya', 'Henry', 'Ava', 'Leo',
  'Isabella', 'Arthur', 'Chloe', 'Freddie', 'Isabelle',
  'Alfie', 'Sienna', 'Archie', 'Evie', 'Theo',
  'Florence', 'Alexander', 'Daisy', 'Edward', 'Phoebe',

  // US
  'Liam', 'Emma', 'Mason', 'Sophia', 'Ethan',
  'Logan', 'Aiden', 'Jackson', 'Charlotte', 'Harper',
  'Caleb', 'Evelyn', 'Benjamin', 'Ella', 'Daniel',
  'Scarlett', 'Matthew', 'Abigail', 'Henry', 'Emily'
]

const lastNames = [
  'Sharma',
  'Patel',
  'Mehta',
  'Deshmukh',
  'Joshi',
  'Kulkarni',
  'Shah',
  'Kapoor',
  'Malhotra',
  'Singh',
  'Verma',
  'Gupta',
  'Iyer',
  'Nair',
  'Reddy',
  'Brown',
  'Smith',
  'Wilson',
  'Taylor',
  'Anderson',
  'Thomas',
  'Jackson',
  'White',
  'Harris',
  'Martin',
  'Thompson',
  'Moore',
  'Clark',
  'Lewis',
  'Walker'
]

/**
 * Generate a random date between two dates.
 */
function randomDateBetween(start, end) {
  const startTime = start.getTime()
  const endTime = end.getTime()

  return new Date(
    startTime + Math.random() * (endTime - startTime)
  )
}

/**
 * Create date ranges for the last 6 months.
 *
 * Today: August 19, 2026
 *
 * We deliberately use fixed dates so the demo dataset
 * remains predictable.
 */
const signupPeriods = [
  {
    label: 'Feb 19-28',
    start: new Date('2026-02-19T00:00:00.000Z'),
    end: new Date('2026-02-28T23:59:59.999Z'),
    count: 8
  },
  {
    label: 'March',
    start: new Date('2026-03-01T00:00:00.000Z'),
    end: new Date('2026-03-31T23:59:59.999Z'),
    count: 24
  },
  {
    label: 'April',
    start: new Date('2026-04-01T00:00:00.000Z'),
    end: new Date('2026-04-30T23:59:59.999Z'),
    count: 28
  },
  {
    label: 'May',
    start: new Date('2026-05-01T00:00:00.000Z'),
    end: new Date('2026-05-31T23:59:59.999Z'),
    count: 32
  },
  {
    label: 'June',
    start: new Date('2026-06-01T00:00:00.000Z'),
    end: new Date('2026-06-30T23:59:59.999Z'),
    count: 36
  },
  {
    label: 'July',
    start: new Date('2026-07-01T00:00:00.000Z'),
    end: new Date('2026-07-31T23:59:59.999Z'),
    count: 40
  },
  {
    label: 'Aug 1-19',
    start: new Date('2026-08-01T00:00:00.000Z'),
    end: new Date('2026-08-19T23:59:59.999Z'),
    count: 32
  }
]

const users = []

let userIndex = 0

for (const period of signupPeriods) {
  for (let i = 0; i < period.count; i++) {
    const firstName = firstNames[userIndex % firstNames.length]
    const lastName =
      lastNames[Math.floor(Math.random() * lastNames.length)]

    const name = `${firstName} ${lastName}`

    // Keep emails deterministic and unique
    const email = `user${userIndex + 1}@easyshop.com`

    const createdAt = randomDateBetween(
      period.start,
      period.end
    )

    users.push({
      userId: generateUserId(email),
      email,
      password: '1234567',
      name,
      createdAt,
      updatedAt: createdAt
    })

    userIndex++
  }
}

async function seedUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI)

    console.log('Connected to MongoDB')

    // Clear existing users
    await User.deleteMany({})

    await User.insertMany(users)

    console.log(
      `Successfully inserted ${users.length} users`
    )

    // Print signup distribution
    console.log('\nSignup distribution:')

    for (const period of signupPeriods) {
      console.log(
        `${period.label}: ${period.count} users`
      )
    }

    console.log('\nSample users:')

    users.slice(0, 5).forEach(user => {
      console.log({
        userId: user.userId,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt
      })
    })

  } catch (error) {
    console.error('Error seeding users:', error)
  } finally {
    await mongoose.disconnect()
  }
}

seedUsers()