// This catalog is the sole authority for executable analytics operations.
const METRICS = {
  sessions: { label: 'Sessions', unit: 'count' },
  users: { label: 'Identified users', unit: 'count' },
  events: { label: 'Tracked events', unit: 'count' },
  orders: { label: 'Purchase events', unit: 'count' },
  revenue: { label: 'Revenue', unit: 'money' },
  aov: { label: 'Average order value', unit: 'money' },
  conversion: { label: 'Session conversion', unit: 'percent', denominator: 'sessions' },
  checkout_conversion: { label: 'Checkout completion', unit: 'percent', denominator: 'checkout sessions' },
  cart_conversion: { label: 'Cart-to-purchase conversion', unit: 'percent', denominator: 'cart sessions' },
  product_conversion: { label: 'Product-to-purchase conversion', unit: 'percent', denominator: 'product-view sessions' },
  add_to_cart_rate: { label: 'Product-to-add-to-cart rate', unit: 'percent', denominator: 'product-view sessions' },
  checkout_abandonment: { label: 'Checkout non-completion', unit: 'percent', denominator: 'checkout sessions' },
  page_views: { label: 'Page views', unit: 'count' },
  checkout_sessions: { label: 'Checkout sessions', unit: 'count' },
  purchasing_sessions: { label: 'Purchasing sessions', unit: 'count' },
};
const GROUPS = ['none', 'device', 'persona', 'day', 'week', 'browser', 'source', 'page', 'event'];
const MODES = ['summary', 'compare', 'trend', 'breakdown', 'funnel', 'diagnose'];
const DEVICES = ['Desktop', 'Mobile', 'Tablet', 'Unknown'];
const PERSONAS = ['loyal', 'firsttime', 'active', 'guest'];
const PERIODS = ['selected', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_days', 'custom'];
const FORMATS = ['auto', 'cards', 'bar', 'line', 'table', 'funnel'];
const STAGES = ['product_view', 'add_to_cart', 'view_cart', 'checkout_start', 'purchase'];
const STAGE_LABELS = { product_view: 'Product view', add_to_cart: 'Add to cart', view_cart: 'Cart', checkout_start: 'Checkout', purchase: 'Purchase' };
const error = (message, status = 400) => Object.assign(new Error(message), { status });
module.exports = { METRICS, GROUPS, MODES, DEVICES, PERSONAS, PERIODS, FORMATS, STAGES, STAGE_LABELS, error };
