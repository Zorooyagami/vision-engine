// scripts/seed/seedEvents.js
//
// Generates ~6 months of realistic e-commerce event history:
// signup -> browse -> product view -> cart -> checkout -> purchase,
// with drop-off at every stage, spread across a growing user base.
//
// Run with:  node scripts/seed/seedEvents.js
//
// Requires: mongoose, and a MONGO_URI env var (or hardcode it below).

require('dotenv').config()
const mongoose = require('mongoose')
const crypto = require('crypto')
const { products } = require('./data/products') // adjust path to your products.js
const User = require('./models/User') // adjust path to your real User model

// =====================================================================
// CONFIG
// =====================================================================

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/shopeasy'

const TOTAL_MONTHS = 6
const MONTHLY_NEW_USERS = [10, 20, 35, 50, 65, 70] // month 1 -> month 6, sums to 250
const NOW = new Date() // "today" = end of the 6-month window

const BATCH_SIZE = 500 // insertMany batch size

// same test password for every seeded user, so you can actually log in
// as any of them during the demo without tracking 250 separate passwords
const SEED_PASSWORD = 'password123'

// =====================================================================
// userId generation — MUST match server/controllers/authController.js
// exactly, or a seeded user's events won't line up with their real
// login-issued userId.
// =====================================================================

function generateUserId(email) {
  const normalizedEmail = email.trim().toLowerCase()
  return crypto.createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 16)
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

// =====================================================================
// EVENT MODEL — loose schema, matches your captured event shape exactly
// =====================================================================

const eventSchema = new mongoose.Schema(
  {
    event: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    url: String,
    path: { type: String, index: true },
    referrer: String,
    properties: mongoose.Schema.Types.Mixed,
    deviceInfo: mongoose.Schema.Types.Mixed,
  },
  { strict: false, versionKey: false }
)

const Event = mongoose.models.Event || mongoose.model('Event', eventSchema, 'events')

// =====================================================================
// HELPERS — random primitives
// =====================================================================

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min
}

function pick(arr) {
  return arr[randomInt(0, arr.length - 1)]
}

// weighted pick: options = [{ value, weight }, ...]
function weightedPick(options) {
  const total = options.reduce((sum, o) => sum + o.weight, 0)
  let r = Math.random() * total
  for (const o of options) {
    if (r < o.weight) return o.value
    r -= o.weight
  }
  return options[options.length - 1].value
}

function chance(probability) {
  return Math.random() < probability
}

function genSessionId() {
  return (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 16)
}

function genOrderId() {
  return `ORD-${randomInt(10000000, 99999999)}`
}

// =====================================================================
// HELPERS — dates
// =====================================================================

// random timestamp within [monthStart, monthEnd), weighted toward
// weekday evenings (6pm-11pm) over other hours, and weekdays over weekends
function randomTimestampInMonth(monthStart, monthEnd) {
  const spanMs = monthEnd.getTime() - monthStart.getTime()
  let t = new Date(monthStart.getTime() + Math.random() * spanMs)

  // bias hour toward evening browsing (18:00-23:00) ~55% of the time
  const hour = chance(0.55) ? randomInt(18, 23) : randomInt(7, 22)
  t.setHours(hour, randomInt(0, 59), randomInt(0, 59), 0)

  // mild weekday bias: if it lands on a weekend, ~40% chance nudge back to nearest weekday
  const day = t.getDay() // 0 = Sun, 6 = Sat
  if ((day === 0 || day === 6) && chance(0.4)) {
    t.setDate(t.getDate() + (day === 0 ? 1 : 2))
  }

  return t
}

function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60000)
}

function monthBounds(monthIndex) {
  // monthIndex 0 = 6 months ago ... TOTAL_MONTHS-1 = current month
  const end = new Date(NOW)
  end.setMonth(end.getMonth() - (TOTAL_MONTHS - 1 - monthIndex))
  const start = new Date(end)
  start.setMonth(start.getMonth() - 1)
  return { start, end: monthIndex === TOTAL_MONTHS - 1 ? NOW : end }
}

// =====================================================================
// HELPERS — device / environment variety
// =====================================================================

const DEVICE_PROFILES = [
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    platform: 'MacIntel', os: 'Mac OS', browser: 'Chrome', deviceType: 'Desktop',
    screen: [1280, 832], weight: 30,
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    platform: 'Win32', os: 'Windows', browser: 'Edge', deviceType: 'Desktop',
    screen: [1366, 768], weight: 20,
  },
  {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    platform: 'iPhone', os: 'iOS', browser: 'Safari', deviceType: 'Mobile',
    screen: [390, 844], weight: 28,
  },
  {
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv8l', os: 'Android', browser: 'Chrome', deviceType: 'Mobile',
    screen: [412, 915], weight: 17,
  },
  {
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    platform: 'iPad', os: 'iOS', browser: 'Safari', deviceType: 'Tablet',
    screen: [820, 1180], weight: 5,
  },
]

const TIMEZONES = [
  { tz: 'Asia/Calcutta', lang: 'en-US', weight: 55 },
  { tz: 'America/New_York', lang: 'en-US', weight: 20 },
  { tz: 'Europe/London', lang: 'en-GB', weight: 15 },
  { tz: 'Asia/Dubai', lang: 'en-US', weight: 10 },
]

function pickDeviceProfile() {
  return weightedPick(DEVICE_PROFILES.map((d) => ({ value: d, weight: d.weight })))
}

function pickTimezone() {
  return weightedPick(TIMEZONES.map((t) => ({ value: t, weight: t.weight })))
}

function buildDeviceInfo(profile, tzInfo, url, path) {
  return {
    userAgent: profile.userAgent,
    platform: profile.platform,
    os: profile.os,
    browser: profile.browser,
    deviceType: profile.deviceType,
    language: tzInfo.lang,
    timezone: tzInfo.tz,
    referrer: '',
    url,
    pathname: path,
    search: '',
    timestamp: new Date().toISOString(),
  }
}

// =====================================================================
// PRODUCT HELPERS
// =====================================================================

function toListItem(product, index) {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    subCategory: product.subCategory,
    price: product.price,
    originalPrice: product.originalPrice,
    discount: product.discount,
    condition: product.condition,
    rating: product.rating,
    stock: product.stock,
    position: index + 1,
    pagePosition: index + 1,
  }
}

function toCartLine(product, quantity = 1) {
  return { ...product, quantity }
}

// =====================================================================
// NAME / EMAIL POOL for shipping details
// =====================================================================

const FIRST_NAMES = ['Aarav', 'Priya', 'Rohan', 'Sneha', 'Vikram', 'Anjali', 'Karan', 'Neha', 'Arjun', 'Divya', 'Sam', 'Alex', 'Jordan', 'Taylor', 'Riya']
const CITIES = [
  { city: 'Mumbai', zip: '400001' },
  { city: 'Pune', zip: '411001' },
  { city: 'Bengaluru', zip: '560001' },
  { city: 'New York', zip: '10001' },
  { city: 'London', zip: 'EC1A1BB' },
  { city: 'Dubai', zip: '00000' },
]

function randomShippingDetails() {
  const name = pick(FIRST_NAMES)
  const loc = pick(CITIES)
  return {
    name,
    email: `${name.toLowerCase()}${randomInt(10, 999)}@example.com`,
    address: `${randomInt(1, 999)} ${pick(['Main St', 'Park Ave', 'MG Road', 'Church St', 'Baker St'])}`,
    city: loc.city,
    zip: loc.zip,
  }
}

// =====================================================================
// SESSION / FUNNEL SIMULATION
// =====================================================================

const BASE_URL = 'http://localhost:5173'
const PAYMENT_METHODS = ['google-pay', 'credit-card', 'paypal', 'apple-pay']

/**
 * Simulates one browsing session for a user and returns an array of event docs.
 * isFirstSession -> emits sign_up instead of login, both on /login.
 * page_view fires on every distinct page arrival, so it naturally ends up
 * the highest-volume event — matching how a real SPA tracker behaves.
 */
function simulateSession(userId, sessionStart, isFirstSession) {
  const events = []
  const sessionId = genSessionId()
  const profile = pickDeviceProfile()
  const tzInfo = pickTimezone()

  let t = new Date(sessionStart)
  let referrer = chance(0.3) ? `${BASE_URL}/products` : `${BASE_URL}/cart`
  const screenWidth = profile.screen[0]
  const screenHeight = profile.screen[1]

  function push(eventName, path, properties, extra = {}) {
    const url = `${BASE_URL}${path}`
    events.push({
      event: eventName,
      userId,
      sessionId,
      timestamp: new Date(t),
      url,
      path,
      referrer,
      properties: {
        title: 'ShopEasy - Ecommerce',
        screenWidth,
        screenHeight,
        ...properties,
      },
      deviceInfo: buildDeviceInfo(profile, tzInfo, url, path),
      ...extra,
    })
    referrer = url
    t = addMinutes(t, randomFloat(0.15, 2.5)) // realistic gap between actions
  }

  // --- auth: happens on /login, always preceded by its own page_view ---
  push('page_view', '/login', {})
  if (isFirstSession) {
    push('sign_up', '/login', { userId })
  } else if (chance(0.9)) {
    push('login', '/login', { userId })
  }

  // --- home ---
  push('page_view', '/', {})

  const cart = [] // { product, quantity }

  // small chance of a direct add_to_cart from a featured product on the
  // home page itself, without ever visiting a PDP
  if (chance(0.08)) {
    const featured = pick(products)
    push('add_to_cart', '/', {
      productId: featured.id,
      price: featured.price,
      source: 'home_featured',
      category: featured.category,
      subCategory: featured.subCategory,
    })
    cart.push({ product: featured, quantity: 1 })
  }

  // --- maybe visit PLP ---
  let visitedPLP = chance(0.75)
  let shuffledProducts = [...products].sort(() => Math.random() - 0.5)
  let visibleList = shuffledProducts.slice(0, 25)

  if (visitedPLP) {
    push('page_view', '/products', {})
    push('view_item_list', '/products', {
      pageNumber: 1,
      itemsPerPage: 25,
      totalItems: products.length,
      totalPages: Math.ceil(products.length / 25),
      sortBy: 'default',
      sortLabel: 'Featured',
      searchQuery: null,
      activeFilters: { categories: [], subCategories: [], brands: [], conditions: [], priceRange: { min: 0, max: 'Infinity' }, inStock: false },
      items: visibleList.map(toListItem),
    })

    if (chance(0.3)) {
      const subCat = pick(products).subCategory
      push('filter_applied', '/products', {
        filterType: 'subCategory',
        filterValue: subCat,
        action: 'apply',
        activeFilters: { categories: [], subCategories: [subCat], brands: [], conditions: [], priceRange: { min: 0, max: 'Infinity' }, inStock: false },
        totalResults: randomInt(3, 30),
      })
    }

    if (chance(0.2)) {
      const term = pick(['pro', 'wireless', 'gaming', 'camera', 'watch', 'black', 'apple', 'sony'])
      push('search_performed', '/products', {
        searchQuery: term,
        resultsCount: randomInt(1, 25),
      })
    }

    if (chance(0.25)) {
      const sort = pick([
        { sortType: 'price-desc', sortLabel: 'Price: High to Low' },
        { sortType: 'price-asc', sortLabel: 'Price: Low to High' },
        { sortType: 'rating-desc', sortLabel: 'Top Rated' },
      ])
      push('sort_changed', '/products', { ...sort, totalResults: randomInt(10, products.length) })
    }
  }

  // --- product browsing loop ---
  const numProductsBrowsed = weightedPick([
    { value: 1, weight: 55 },
    { value: 2, weight: 30 },
    { value: 3, weight: 15 },
  ])

  const browsedProducts = []
  for (let i = 0; i < numProductsBrowsed; i++) {
    const product = pick(products)
    browsedProducts.push(product)
    const path = `/products-detail/${product.id}`
    const idxInList = visibleList.findIndex((p) => p.id === product.id)

    if (visitedPLP && idxInList !== -1 && chance(0.85)) {
      push('select_item', path, {
        productId: product.id,
        position: idxInList + 1,
        name: product.name,
        category: product.name,
        subCategory: product.name,
        brand: product.brand,
        color: product.color,
        condition: product.condition,
        rating: product.rating,
        tags: product.tags,
        price: product.price,
      })
    }

    // arriving at the PDP always fires page_view first, whether the user
    // clicked through from the list or landed here directly
    push('page_view', path, {})

    push('product_view', path, {
      productId: product.id,
      position: product.id,
      name: product.name,
      category: product.name,
      subCategory: product.name,
      brand: product.brand,
      color: product.color,
      condition: product.condition,
      rating: product.rating,
      tags: product.tags,
    })

    if (chance(0.35)) {
      push('add_to_cart', path, {
        productId: product.id,
        price: product.price,
        source: 'product_page',
        category: product.category,
        subCategory: product.subCategory,
      })
      cart.push({ product, quantity: randomInt(1, 2) })
    }
  }

  // --- cart / checkout funnel ---
  if (cart.length > 0) {
    if (chance(0.85)) {
      push('page_view', '/cart', {})
      const totalPrice = cart.reduce((s, c) => s + c.product.price * c.quantity, 0)
      push('view_cart', '/cart', {
        products: cart.map((c) => toCartLine(c.product, c.quantity)),
        totalPrice,
        totalItems: cart.reduce((s, c) => s + c.quantity, 0),
      })

      if (cart.length > 1 && chance(0.15)) {
        const removedIdx = randomInt(0, cart.length - 1)
        const removed = cart[removedIdx]
        push('remove_from_cart', '/cart', {
          id: removed.product.id,
          category: removed.product.category,
          price: removed.product.price,
        })
        cart.splice(removedIdx, 1)
      }

      if (cart.length > 0 && chance(0.45)) {
        const totalPriceNow = cart.reduce((s, c) => s + c.product.price * c.quantity, 0)

        // clicking "proceed to buy" on /cart navigates to /shipping-info
        push('page_view', '/shipping-info', {})
        push('checkout_start', '/shipping-info', {
          products: cart.map((c) => toCartLine(c.product, c.quantity)),
          totalPrice: totalPriceNow,
          totalItems: cart.reduce((s, c) => s + c.quantity, 0),
        })

        if (chance(0.85)) {
          // filling + submitting the shipping form happens on the same
          // /shipping-info page, no new page_view for this one
          const shipping = randomShippingDetails()
          push('shipping_details', '/shipping-info', {
            products: cart.map((c) => toCartLine(c.product, c.quantity)),
            totalPrice: totalPriceNow,
            totalItems: cart.reduce((s, c) => s + c.quantity, 0),
            shippingDetails: shipping,
          })

          // submitting shipping navigates to /payment
          push('page_view', '/payment', {})

          if (chance(0.9)) {
            push('purchase', '/payment', {
              orderId: genOrderId(),
              total: totalPriceNow.toFixed(2),
              paymentMethod: pick(PAYMENT_METHODS),
              products: cart.map((c) => ({
                productId: c.product.id,
                productName: c.product.name,
                productPrice: c.product.price,
                productQuantity: c.quantity,
              })),
            })

            // successful payment redirects to /confirmation
            push('page_view', '/confirmation', {})
          }
        }
      }
    }
  }

  return events
}

// =====================================================================
// USER + SESSION COUNT GENERATION
// =====================================================================

// how many total sessions a user gets across their lifetime (signup -> NOW)
function pickSessionCount() {
  return weightedPick([
    { value: 1, weight: 35 },
    { value: 2, weight: 25 },
    { value: 3, weight: 15 },
    { value: randomInt(4, 6), weight: 15 },
    { value: randomInt(7, 12), weight: 10 },
  ])
}

function generateUserEvents(userId, signupDate) {
  const allEvents = []
  const sessionCount = pickSessionCount()

  // first session = the signup session itself
  allEvents.push(...simulateSession(userId, signupDate, true))

  // remaining sessions, spread randomly between signup and NOW
  for (let i = 1; i < sessionCount; i++) {
    const spanMs = NOW.getTime() - signupDate.getTime()
    if (spanMs <= 0) break
    const sessionStart = new Date(signupDate.getTime() + Math.random() * spanMs)
    allEvents.push(...simulateSession(userId, sessionStart, false))
  }

  return allEvents
}

// =====================================================================
// MAIN
// =====================================================================

async function run() {
  await mongoose.connect(MONGO_URI)
  console.log('[seed] connected to Mongo')

  const summary = {} // event name -> count
  let totalUsers = 0
  let batch = []

  async function flushBatch(force = false) {
    if (batch.length === 0) return
    if (!force && batch.length < BATCH_SIZE) return
    await Event.insertMany(batch, { ordered: false })
    batch = []
  }

  for (let monthIndex = 0; monthIndex < TOTAL_MONTHS; monthIndex++) {
    const newUsersThisMonth = MONTHLY_NEW_USERS[monthIndex]
    const { start, end } = monthBounds(monthIndex)

    for (let i = 0; i < newUsersThisMonth; i++) {
      // --- create a real, loggable-in User document first ---
      let user = null
      let attempts = 0
      while (!user && attempts < 5) {
        attempts++
        const first = pick(FIRST_NAMES)
        const email = normalizeEmail(`${first.toLowerCase()}.${randomInt(100, 99999)}@example.com`)
        const userId = generateUserId(email)

        const existing = await User.findOne({ $or: [{ email }, { userId }] })
        if (existing) continue // collision (rare) — retry with a new random email

        try {
          user = await User.create({
            userId,
            email,
            password: SEED_PASSWORD, // plain text, matching authController's current scheme
            name: first,
          })
        } catch (err) {
          if (err.code === 11000) continue // duplicate key race — retry
          throw err
        }
      }

      if (!user) {
        console.warn('[seed] could not create a unique user after 5 attempts, skipping')
        continue
      }

      // --- generate this user's event history under their real userId ---
      const signupDate = randomTimestampInMonth(start, end)
      const userEvents = generateUserEvents(user.userId, signupDate)

      for (const ev of userEvents) {
        summary[ev.event] = (summary[ev.event] || 0) + 1
      }

      batch.push(...userEvents)
      totalUsers++

      await flushBatch()
    }

    console.log(`[seed] month ${monthIndex + 1}/${TOTAL_MONTHS}: +${newUsersThisMonth} users (running total: ${totalUsers})`)
  }

  await flushBatch(true) // flush remainder

  console.log('\n[seed] done.')
  console.log(`[seed] total users created: ${totalUsers}`)
  console.log(`[seed] all seeded users share the password: "${SEED_PASSWORD}"`)
  console.log('[seed] log in as any of them via POST /api/auth/login with their email + that password')
  console.log('[seed] event counts:')
  Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => console.log(`  ${name.padEnd(20)} ${count}`))

  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('[seed] failed:', err)
  process.exit(1)
})