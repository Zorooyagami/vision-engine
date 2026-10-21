const crypto = require('crypto');
const User = require('../models/User');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateUserId(email, projectId = null) {
  const normalizedEmail = normalizeEmail(email);
  console.log('[auth] login lookup:', { projectId, normalizedEmail });

  const seed = projectId ? `${projectId}:${normalizedEmail}` : normalizedEmail;
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
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
      password: String(password),
      name: String(name).trim(),
    });
console.log('[auth] user found:', !!user, 'stored password:', user?.password);
    res.status(201).json({ userId: user.userId, email: user.email, name: user.name });
  } catch (err) {
    console.error('[auth] signup error:', err.message);
    res.status(500).json({ error: 'failed to sign up' });
  }
}

async function login(req, res) {
  try {
    console.log('[auth] headers:', req.headers);
console.log('[auth] body:', req.body);
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const projectId = req.projectId || null;
    const normalizedEmail = normalizeEmail(email);
    console.log('[auth] login lookup:', { projectId, normalizedEmail });
    const user = await User.findOne({ projectId, email: normalizedEmail });
    const valid = user ? user.password === String(password) : false;

    if (!valid) return res.status(401).json({ error: 'invalid email or password' });

    res.json({ userId: user.userId, email: user.email, name: user.name });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: 'failed to log in' });
  }
}

module.exports = { signup, login };