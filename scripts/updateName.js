/**
 * One-time update of seeded Dev Day users' names and emails.
 *
 * Required .env values:
 *   MONGO_URI=mongodb+srv://...
 *   PROJECT_ID=vis_6bcd1aef732e0d5d
 *
 * Preview:
 *   node scripts/updateDemoUsers.js
 *
 * Apply:
 *   DRY_RUN=false node scripts/updateDemoUsers.js
 *
 * Preserves userId, passwords, and existing event/session links.
 */

require('dotenv').config();

const mongoose = require('mongoose');
const Project = require('../models/Project');
const User = require('../models/User');

const FIRST_NAMES  = [
  "Aarav", "Aisha", "Akira", "Alan", "Alberto", "Alex", "Alexis", "Alice", "Amara", "Amelia",
  "Amir", "Ananya", "Anders", "Andre", "Andrea", "Angela", "Anika", "Anita", "Anjali", "Anthony",
  "Antonio", "Aria", "Ariana", "Arjun", "Arthur", "Asha", "Ashley", "Aurora", "Ava", "Ayesha",
  "Beatriz", "Ben", "Bianca", "Blake", "Brandon", "Brenda", "Brian", "Bruce", "Bruno", "Caleb",
  "Camila", "Carlos", "Carmen", "Carol", "Catherine", "Cecilia", "Chandra", "Charles", "Charlotte", "Chloe",
  "Chris", "Claire", "Clara", "Claudia", "Colin", "Connor", "Crystal", "Cynthia", "Damon", "Daniel",
  "Daniela", "Dante", "Darius", "David", "Dawn", "Declan", "Deepak", "Delia", "Dennis", "Derek",
  "Devi", "Diana", "Diego", "Dinesh", "Divya", "Dominic", "Donald", "Donna", "Dorothy", "Dylan",
  "Eden", "Edith", "Edward", "Elena", "Eli", "Eliana", "Elijah", "Elizabeth", "Ella", "Elliot",
  "Emanuel", "Emilia", "Emily", "Emma", "Erica", "Eric", "Erika", "Erin", "Esther", "Ethan",
  "Eva", "Evelyn", "Ezra", "Fatima", "Felix", "Fernando", "Fiona", "Florence", "Frances", "Frank",
  "Gabriel", "Gabriela", "Ganesh", "Gary", "Gauri", "Gemma", "George", "Georgia", "Gerald", "Gina",
  "Gloria", "Grace", "Gregory", "Gwen", "Hana", "Hannah", "Harini", "Harold", "Harper", "Harrison",
  "Hazel", "Heather", "Hector", "Helen", "Henry", "Himani", "Hiroshi", "Holly", "Hugo", "Ian",
  "Ibrahim", "Imani", "Imran", "Indira", "Irene", "Isaac", "Isabel", "Isabella", "Ishaan", "Isla",
  "Ivan", "Jack", "Jackson", "Jacob", "Jade", "Jaime", "James", "Jamie", "Janaki", "Janet",
  "Janice", "Jasmine", "Jason", "Javier", "Jay", "Jaya", "Jean", "Jeffrey", "Jennifer", "Jenny",
  "Jeremy", "Jerome", "Jessica", "Jia", "Jill", "Jimmy", "Joan", "Joanna", "Joel", "John",
  "Jonathan", "Jordan", "Jose", "Joseph", "Josephine", "Joshua", "Joyce", "Juan", "Judith", "Julia",
  "Julian", "Julie", "Justin", "Kabir", "Kai", "Kaitlyn", "Kala", "Kamala", "Karen", "Karan",
  "Katherine", "Kathy", "Katie", "Kavya", "Kayla", "Keith", "Kelly", "Kenneth", "Kevin", "Khushi",
  "Kiara", "Kimberly", "Kiran", "Krishna", "Kristen", "Kristin", "Kylie", "Lakshmi", "Lara", "Larry",
  "Laura", "Lauren", "Lavanya", "Lawrence", "Layla", "Leah", "Leon", "Leonardo", "Leslie", "Liam",
  "Lila", "Lily", "Linda", "Lisa", "Logan", "Lola", "Lorraine", "Louis", "Lucas", "Lucia",
  "Lucy", "Luis", "Lydia", "Madhav", "Madison", "Maeve", "Maggie", "Mia", "Miguel", "Mihir",
  "Mika", "Milan", "Mira", "Miriam", "Mitchell", "Mohamed", "Molly", "Monica", "Morgan", "Mukesh",
  "Nadia", "Naina", "Nancy", "Naomi", "Natalie", "Natasha", "Nathan", "Naveen", "Neha", "Neil",
  "Nelson", "Nicholas", "Nicole", "Nikhil", "Nina", "Noah", "Noel", "Nora", "Norman", "Olivia",
  "Omar", "Oscar", "Owen", "Padma", "Pamela", "Paola", "Patricia", "Patrick", "Paul", "Paula",
  "Pedro", "Penelope", "Peter", "Philip", "Phoebe", "Pooja", "Prabhu", "Pranav", "Preeti", "Priya",
  "Quinn", "Rachel", "Rahul", "Raj", "Rakesh", "Ralph", "Ram", "Ramesh", "Rani", "Ravi",
  "Raymond", "Rebecca", "Regina", "Renee", "Ricardo", "Richard", "Ricky", "Rita", "Robert", "Roberta",
  "Roberto", "Robin", "Rohan", "Rohit", "Ronald", "Rosa", "Rose", "Rosemary", "Ruby", "Russell",
  "Ruth", "Ryan", "Sabrina", "Sachin", "Sadie", "Sahil", "Samantha", "Samuel", "Sandra", "Sangeeta",
  "Sanjay", "Sara", "Sarah", "Sasha", "Savitri", "Scarlett", "Scott", "Sean", "Sebastian", "Serena",
  "Sergio", "Shane", "Shanti", "Sharon", "Shreya", "Shweta", "Sienna", "Simon", "Simran", "Sneha",
  "Sofia", "Sonia", "Sophia", "Spencer", "Stella", "Stephanie", "Stephen", "Steven", "Stuart", "Sudha",
  "Suman", "Sunil", "Sunita", "Susan", "Suzanne", "Swati", "Sydney", "Sylvia", "Tamara", "Tanya",
  "Tara", "Taylor", "Teresa", "Terry", "Theo", "Theodore", "Thomas", "Tiffany", "Timothy", "Tina",
  "Tomas", "Tracy", "Travis", "Trevor", "Trisha", "Tyler", "Uma", "Umesh", "Valentina", "Valerie",
  "Vanessa", "Varun", "Vera", "Veronica", "Victor", "Victoria", "Vincent", "Vikram", "Vinod", "Violet",
  "Vishal", "Vivaan", "Vivian", "Walter", "Wendy", "Wesley", "William", "Willow", "Xander", "Yamini",
  "Yash", "Yasmin", "Yusuf", "Zachary", "Zara", "Zoe"
]

const LAST_NAMES = [
  'Sharma', 'Patel', 'Shah', 'Mehta', 'Rao',
  'Nair', 'Iyer', 'Joshi', 'Desai', 'Kapoor',
  'Verma', 'Gupta', 'Singh', 'Malhotra', 'Kulkarni',
  'Menon', 'Bose', 'Sen', 'Saxena', 'Bhat',
];

function createIdentity(user, index) {
  // Cycle first names before moving to the next surname.
  // Supports 400 unique full names with these arrays.
  const firstName = FIRST_NAMES[index % FIRST_NAMES.length];
  const lastName =
    LAST_NAMES[Math.floor(index / FIRST_NAMES.length)];

  const name = firstName;

  // Stable, unique suffix. Do not regenerate userId from this email.
  const suffix = user._id.toHexString();
  const email =
    `${firstName}.${lastName}@devday.com`.toLowerCase();

  return { name, email };
}

async function main() {
  const projectId =
    process.env.PROJECT_ID || 'vis_6bcd1aef732e0d5d';

  const mongoUri = 'mongodb+srv://zorooyagami_db_user:CIkhZNwzcx2Xpfu1@vision-engine.e8foaez.mongodb.net/vision?appName=vision-engine';
  const dryRun = 'true'//process.env.DRY_RUN !== 'false';

  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(mongoUri);

  const project = await Project.findOne({ projectId })
    .select('projectId')
    .lean();

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const users = await User.find({ projectId })
    .select('_id userId name email')
    .sort({ _id: 1 })
    .lean();

  console.log(`[updateDemoUsers] project: ${projectId}`);
  console.log(`[updateDemoUsers] users found: ${users.length}`);
  console.log(`[updateDemoUsers] mode: ${dryRun ? 'PREVIEW' : 'APPLY'}`);

  if (!users.length) {
    console.log('[updateDemoUsers] Nothing to update.');
    return;
  }

  const capacity = FIRST_NAMES.length * LAST_NAMES.length;

  if (users.length > capacity) {
    throw new Error(
      `Found ${users.length} users, but only ${capacity} unique ` +
      'name combinations are available. Add more names to the arrays.',
    );
  }

  const updates = users.map((user, index) => ({
    user,
    ...createIdentity(user, index),
  }));

  console.table(
    updates.slice(0, 10).map(({ user, name, email }) => ({
      userId: user.userId,
      oldName: user.name,
      newName: name,
      oldEmail: user.email,
      newEmail: email,
    })),
  );

  // Skip unchanged documents on repeated runs with the same dataset.
  const changed = updates.filter(
    ({ user, name, email }) =>
      user.name !== name || user.email !== email,
  );

  console.log(
    `[updateDemoUsers] documents requiring changes: ${changed.length}`,
  );

//   if (dryRun) {
//     console.log(
//       '[updateDemoUsers] No changes written. ' +
//       'Run with DRY_RUN=false to apply.',
//     );
//     return;
//   }

  if (!changed.length) {
    console.log('[updateDemoUsers] All users already match.');
    return;
  }

  const updatedAt = new Date();

  const operations = changed.map(({ user, name, email }) => ({
    updateOne: {
      filter: {
        _id: user._id,
        projectId,
      },
      update: {
        $set: {
          name,
          email,
          updatedAt,
        },
      },
      upsert: false,
    },
  }));

  const result = await User.bulkWrite(operations, {
    ordered: true,
  });

  console.log('[updateDemoUsers] Completed');
  console.log(`  matched: ${result.matchedCount}`);
  console.log(`  modified: ${result.modifiedCount}`);
  console.log('  userId values preserved');
}

main()
  .catch((error) => {
    console.log("err", error)
    // Avoid printing connection strings or credentials from error details.
    console.error(
      '[updateDemoUsers] Failed:',
      error.name,
      error.code ? `(code ${error.code})` : '',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      console.error('[updateDemoUsers] Failed to disconnect');
      process.exitCode = 1;
    }
  });