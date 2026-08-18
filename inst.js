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
let names =[
  // 40 Indian names
  "Aarav", "Priya", "Vivaan", "Ananya", "Aditya", "Saanvi", "Arjun", "Diya", "Reyansh", "Aadhya",
  "Vihaan", "Myra", "Atharv", "Anika", "Kabir", "Ishita", "Shaurya", "Kiara", "Dhruv", "Pari",
  "Krishna", "Aisha", "Rudra", "Navya", "Ayaan", "Riya", "Yash", "Sneha", "Rohan", "Meera",
  "Karan", "Pooja", "Siddharth", "Kavya", "Nikhil", "Shreya", "Aman", "Tanvi", "Harsh", "Nisha",

  // 40 UK names
  "Oliver", "Amelia", "George", "Isla", "Harry", "Olivia", "Jack", "Emily", "Charlie", "Sophie",
  "Thomas", "Grace", "James", "Mia", "William", "Poppy", "Noah", "Ella", "Joshua", "Lily",
  "Oscar", "Freya", "Henry", "Ava", "Leo", "Isabella", "Arthur", "Chloe", "Freddie", "Isabelle",
  "Alfie", "Sienna", "Archie", "Evie", "Theo", "Florence", "Alexander", "Daisy", "Edward", "Phoebe",

  // 20 US names
  "Liam", "Emma", "Noah", "Olivia", "Mason", "Ava", "Ethan", "Sophia", "Logan", "Isabella",
  "Aiden", "Mia", "Jackson", "Charlotte", "Lucas", "Amelia", "Jayden", "Harper", "Caleb", "Evelyn"
]

const users = Array.from({ length: 100 }, (_, index) => {
  const email = `${index + 1}@easyshop.com`

  return {
    userId: generateUserId(email),
    email,
    password: '1234567',
    name: names[index],
  }
})

async function seedUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI)

    // Optional: clear existing demo users
    await User.deleteMany({})

    await User.insertMany(users)

    console.log('100 users inserted successfully')
  } catch (error) {
    console.error('Error seeding users:', error)
  } finally {
    await mongoose.disconnect()
  }
}

seedUsers()