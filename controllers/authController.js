const crypto = require('crypto');
const User = require('../models/User');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateUserId(email, projectId = null) {
  const normalizedEmail = normalizeEmail(email);
  const seed = projectId ? `${projectId}:${normalizedEmail}` : normalizedEmail;
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scryptAsync(String(password), salt);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (!stored?.startsWith('scrypt$')) {
    // Backward compatibility for existing demo users. Successful login will
    // transparently upgrade the stored plaintext password below.
    return stored === password;
  }

  const [, salt, expectedHex] = stored.split('$');
  if (!salt || !expectedHex) return false;
  const actual = await scryptAsync(String(password), salt);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function signup(req, res) {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password and name are all required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const projectId = req.projectId || null;
    const normalizedEmail = normalizeEmail(email);
    const existing = await User.findOne({ projectId, email: normalizedEmail });
    if (existing) return res.status(409).json({ error: 'an account with this email already exists' });

    const user = await User.create({
      projectId,
      userId: generateUserId(normalizedEmail, projectId),
      email: normalizedEmail,
      password: await hashPassword(password),
      name: String(name).trim(),
    });

    res.status(201).json({ userId: user.userId, email: user.email, name: user.name });
  } catch (err) {
    console.error('[auth] signup error:', err.message);
    res.status(500).json({ error: 'failed to sign up' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const projectId = req.projectId || null;
    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ projectId, email: normalizedEmail });
    const valid = user ? await verifyPassword(password, user.password) : false;

    if (!valid) return res.status(401).json({ error: 'invalid email or password' });

    if (!user.password.startsWith('scrypt$')) {
      user.password = await hashPassword(password);
      await user.save();
    }

    res.json({ userId: user.userId, email: user.email, name: user.name });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: 'failed to log in' });
  }
}


module.exports = { signup, login };
