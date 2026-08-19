/**
 * Auth Controller — basic signup & login
 * ---------------------------------------
 * DELIBERATELY MINIMAL, matching the existing inst.js seed script's
 * approach: passwords are stored and compared as PLAIN TEXT, and there
 * is NO session/JWT/cookie issued — the frontend just stores the
 * returned {userId, email, name} in localStorage (as `auth_user`),
 * exactly what visionTracker.js's getUserId() already expects to read.
 *
 * This is NOT production-grade auth (no hashing, no rate limiting, no
 * token expiry) — it's intentionally basic, per the demo's scope. If
 * this ever needs to be real, swap the plain comparisons below for
 * bcrypt.compare()/bcrypt.hash() and issue a real session/JWT instead.
 *
 * userId generation is IDENTICAL to inst.js's generateUserId(), so a
 * newly signed-up user's ID stays consistent with the already-seeded
 * 100 demo users if you ever need to cross-reference them.
 */

const crypto = require("crypto");
const User = require("../models/User");

function generateUserId(email) {
  const normalizedEmail = email.trim().toLowerCase();
  return crypto.createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 16);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * POST /api/auth/signup
 * Body: { email, password, name }
 */
async function signup(req, res) {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: "email, password and name are all required" });
    }

    const normalizedEmail = normalizeEmail(email);

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: "an account with this email already exists" });
    }

    const userId = generateUserId(normalizedEmail);

    const user = await User.create({
      userId,
      email: normalizedEmail,
      password, // plain text — see file header note
      name: String(name).trim(),
    });

    // Never echo the password back, even though it's plain text here.
    return res.status(201).json({
      userId: user.userId,
      email: user.email,
      name: user.name,
    });
  } catch (err) {
    console.error("[auth] signup error:", err.message);
    return res.status(500).json({ error: "failed to sign up" });
  }
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail });

    // Generic error message on purpose — doesn't reveal whether the
    // email exists or the password was wrong.
    if (!user || user.password !== password) {
      return res.status(401).json({ error: "invalid email or password" });
    }

    return res.json({
      userId: user.userId,
      email: user.email,
      name: user.name,
    });
  } catch (err) {
    console.error("[auth] login error:", err.message);
    return res.status(500).json({ error: "failed to log in" });
  }
}

module.exports = { signup, login };
