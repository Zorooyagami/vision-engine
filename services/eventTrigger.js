// services/eventTrigger.js
//
// Validation / normalisation for dashboard-defined event triggers
// ("when an element matching <selector> is clicked on <pages>, fire <event>").
//
// Everything a dashboard user types ends up in the SDK running on a customer's
// site, so this is the single gate that decides what shape is allowed.

const URL_MATCH_MODES = ['any', 'equals', 'contains', 'starts_with']
const PROPERTY_SOURCES = ['text', 'attr', 'value', 'static']

// Keys the SDK always sets itself; a custom property must not shadow them.
const RESERVED_PROPERTY_KEYS = new Set(['eventSource', 'selector', 'elementText', 'tag'])

const MAX_SELECTOR_LENGTH = 500
const MAX_URL_VALUE_LENGTH = 300
const MAX_PROPERTIES = 10
const PROPERTY_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,59}$/
const ATTR_NAME_RE = /^[A-Za-z_:][-A-Za-z0-9_:.]{0,59}$/

function invalid(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

// Accept either "/products" or a full URL someone pasted; store the path only.
function normalisePathValue(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      return url.pathname
    } catch {
      throw invalid('URL match value is not a valid URL')
    }
  }
  return value
}

function sanitizeProperty(raw, index) {
  if (!raw || typeof raw !== 'object') throw invalid(`Property #${index + 1} is invalid`)

  const key = String(raw.key ?? '').trim()
  if (!PROPERTY_KEY_RE.test(key)) {
    throw invalid(`Property name "${key}" must start with a letter/underscore and use only letters, numbers and _ (max 60)`)
  }
  if (RESERVED_PROPERTY_KEYS.has(key)) throw invalid(`Property name "${key}" is reserved`)

  const from = String(raw.from ?? 'text')
  if (!PROPERTY_SOURCES.includes(from)) throw invalid(`Unsupported property source: ${from}`)

  let source = String(raw.source ?? '').trim()
  if (from === 'attr') {
    if (!ATTR_NAME_RE.test(source)) throw invalid(`Property "${key}" needs a valid attribute name`)
  } else if (from === 'static') {
    if (source.length > 200) throw invalid(`Fixed value for "${key}" must be 200 characters or fewer`)
  } else {
    source = ''
  }

  return { key, from, source }
}

/**
 * @returns {object} a clean trigger ready to store
 * @throws  Error with .status = 400 for anything the dashboard should show to the user
 */
function sanitizeTrigger(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('trigger must be an object')

  const kind = String(raw.kind ?? 'click')
  if (kind !== 'click') throw invalid(`Unsupported trigger kind: ${kind}`)

  const selector = String(raw.selector ?? '').trim()
  if (!selector) throw invalid('A CSS selector is required')
  if (selector.length > MAX_SELECTOR_LENGTH) throw invalid(`Selector must be ${MAX_SELECTOR_LENGTH} characters or fewer`)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(selector)) throw invalid('Selector contains invalid characters')

  const mode = String(raw.urlMatch?.mode ?? 'any')
  if (!URL_MATCH_MODES.includes(mode)) throw invalid(`Unsupported URL match mode: ${mode}`)

  let urlValue = ''
  if (mode !== 'any') {
    urlValue = normalisePathValue(raw.urlMatch?.value)
    if (!urlValue) throw invalid('A page path is required for this URL rule')
    if (urlValue.length > MAX_URL_VALUE_LENGTH) throw invalid(`Page path must be ${MAX_URL_VALUE_LENGTH} characters or fewer`)
    if ((mode === 'equals' || mode === 'starts_with') && !urlValue.startsWith('/')) {
      throw invalid('Page path must start with "/" for "is exactly" and "starts with" rules')
    }
  }

  const rawProps = Array.isArray(raw.properties) ? raw.properties : []
  if (rawProps.length > MAX_PROPERTIES) throw invalid(`At most ${MAX_PROPERTIES} captured properties are allowed`)
  const properties = rawProps
    .filter((p) => p && String(p.key ?? '').trim() !== '')
    .map(sanitizeProperty)
  if (new Set(properties.map((p) => p.key)).size !== properties.length) {
    throw invalid('Captured property names must be unique')
  }

  return { kind, selector, urlMatch: { mode, value: urlValue }, properties }
}

module.exports = {
  sanitizeTrigger,
  URL_MATCH_MODES,
  PROPERTY_SOURCES,
  RESERVED_PROPERTY_KEYS,
}
