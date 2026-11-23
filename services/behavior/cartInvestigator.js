'use strict'

const CART_KINDS = new Set(['cart_updated', 'checkout_started', 'purchase_completed'])
const FRICTION_KINDS = new Set(['repeated_click', 'validation_failure', 'javascript_error', 'action_failure'])
const VIEW_KINDS = new Set(['page_view', 'product_view'])
const LEGACY_CART = new Set(['add_to_cart'])
const LEGACY_CHECKOUT = new Set(['checkout_start'])
const LEGACY_PURCHASE = new Set(['purchase'])
const LABELS = {cart_updated:'Cart changed',checkout_started:'Checkout started',purchase_completed:'Purchase event',repeated_click:'Repeated click',validation_failure:'Validation failure',javascript_error:'JavaScript error',action_failure:'Action failure',page_view:'Page viewed',product_view:'Product viewed',add_to_cart:'Added to cart',checkout_start:'Checkout started',purchase:'Purchase event',view_cart:'Cart viewed',remove_from_cart:'Removed from cart'}
const time = e => +new Date(e.timestamp)
const order = (a,b) => time(a)-time(b) || String(a.eventId).localeCompare(String(b.eventId))

// An analytics `purchase` and a behavioral `purchase_completed` can describe
// the same checkout. Use order IDs whenever present; only use a narrowly
// constrained session/time fallback when at least one ID is missing.
const normalizeOrderId = value => value == null ? '' : String(value).trim()
function uniquePurchases(purchases) {
  const parent = purchases.map((_, i) => i)
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const join = (a, b) => { const ra = root(a), rb = root(b); if (ra !== rb) parent[rb] = ra }
  const byOrder = new Map()
  purchases.forEach((p, i) => {
    if (!p.orderId) return
    if (byOrder.has(p.orderId)) join(i, byOrder.get(p.orderId))
    else byOrder.set(p.orderId, i)
  })

  // Fallback only for a single unambiguous cross-stream match in the same
  // session within two seconds. Never merge two different known order IDs.
  // Never merge different purchases solely because they share a session.
  const candidates = purchases.map((p, i) => purchases.map((q, j) => ({q, j}))
    .filter(({q, j}) => i !== j && p.source !== q.source &&
      p.sessionId && p.sessionId === q.sessionId &&
      (!p.orderId || !q.orderId) &&
      Math.abs(p.timestamp - q.timestamp) <= 2000)
    .map(({j}) => j))
  let fallbackMatches = 0
  candidates.forEach((matches, i) => {
    if (matches.length !== 1) return
    const j = matches[0]
    if (candidates[j].length !== 1 || candidates[j][0] !== i) return
    if (root(i) !== root(j)) { join(i, j); fallbackMatches++ }
  })
  return {
    count: new Set(purchases.map((_, i) => root(i))).size,
    rawCount: purchases.length,
    duplicatesRemoved: purchases.length - new Set(purchases.map((_, i) => root(i))).size,
    fallbackMatches,
  }
}

function investigateCart(events, { now = new Date(), limit = 8, offset = 0, status = 'all', analyticsEvents = [] } = {}) {
  const seen = new Set()
  const normalized = (events || []).filter(e => {
    if (!e?.eventId || !e.sessionId || !Number.isFinite(time(e)) || time(e) > +now || seen.has(e.eventId)) return false
    seen.add(e.eventId); return true
  }).sort(order)
  const sessions = new Map()
  for (const e of normalized) {
    if (!sessions.has(e.sessionId)) sessions.set(e.sessionId, [])
    sessions.get(e.sessionId).push(e)
  }
  // Purchase coverage is intentionally independent of the cart-journey filter.
  // A purchase can be tracked in a session whose earlier cart activity was not
  // recorded (older SDK, late SDK startup, or a cart created in another session).
  const purchaseSessions = new Set()
  const purchaseOrderKeys = new Set()
  const purchaseOccurrences = []
  let behaviorPurchaseEvents = 0
  let analyticsPurchaseEvents = 0
  for (const e of normalized) {
    if (e.kind !== 'purchase_completed') continue
    behaviorPurchaseEvents++
    purchaseOccurrences.push({source:'behavior',orderId:normalizeOrderId(e.data?.orderId),sessionId:e.sessionId,timestamp:time(e)})
    purchaseSessions.add(e.sessionId)
    if (e.data?.orderId) purchaseOrderKeys.add(String(e.data.orderId))
  }
  const cases = []
  const strictSessions = new Set()
  for (const [sessionId, stream] of sessions) {
    const cartEvents = stream.filter(e => CART_KINDS.has(e.kind) && e.data?.cartId)
    const firstCart = cartEvents.find(e => e.kind === 'cart_updated' && e.data?.itemCount > 0) || cartEvents.find(e => e.kind === 'checkout_started' && e.data?.itemCount > 0)
    if (!firstCart) continue
    const cartId = firstCart.data.cartId
    const start = time(firstCart)
    const matching = cartEvents.filter(e => e.data.cartId === cartId && time(e) >= start)
    const hasCheckout = matching.some(e => e.kind === 'checkout_started')
    const hasPurchase = matching.some(e => e.kind === 'purchase_completed')
    const latest = matching[matching.length - 1]
    const empty = !hasPurchase && latest?.kind === 'cart_updated' && latest.data?.itemCount === 0
    const status = hasPurchase ? 'purchase_recorded' : empty ? 'cart_emptied' : hasCheckout ? 'checkout_no_purchase' : 'cart_no_checkout'
    const after = stream.filter(e => time(e) >= start)
    const friction = after.filter(e => FRICTION_KINDS.has(e.kind))
    const timeline = after.filter(e => CART_KINDS.has(e.kind) || FRICTION_KINDS.has(e.kind) || VIEW_KINDS.has(e.kind))
      .slice(0, 80).map(e => ({ eventId:e.eventId, kind:e.kind, label:LABELS[e.kind] || e.kind, time:e.timestamp, path:e.path || '/', cartId:CART_KINDS.has(e.kind) ? e.data?.cartId || null : null, element:FRICTION_KINDS.has(e.kind) ? e.data?.element || null : null, code:FRICTION_KINDS.has(e.kind) ? e.data?.code || null : null }))
    cases.push({sessionId, visitorId:firstCart.visitorId || null, userId:firstCart.userId || null, device:firstCart.device || 'Unknown', cartId, source:'behavior', evidence:'Cart ID and positive item count recorded', firstCartAt:firstCart.timestamp, lastSeenAt:stream[stream.length-1].timestamp, status, checkoutObserved:hasCheckout, purchaseObserved:hasPurchase, frictionCount:friction.length, lastPath:stream[stream.length-1].path || '/', eventCount:after.length, timeline, hasReplay:false})
    strictSessions.add(sessionId)
  }

  // Older SDK installations sent these standard /api/events event names but did
  // not emit a BehaviorEvent with a cartId. Show them as weaker, session-level
  // evidence rather than silently discarding the real recorded activity.
  const legacyStreams = new Map()
  const legacyIds = new Set()
  let analyticsCartEvents = 0
  for (const e of analyticsEvents || []) {
    if (!e?.sessionId || !Number.isFinite(time(e)) || time(e) > +now) continue
    const id = String(e._id || e.eventId || '')
    if (!id || legacyIds.has(id)) continue
    legacyIds.add(id)
    if (!legacyStreams.has(e.sessionId)) legacyStreams.set(e.sessionId, [])
    legacyStreams.get(e.sessionId).push(e)
    if (LEGACY_CART.has(e.event)) analyticsCartEvents++
    if (LEGACY_PURCHASE.has(e.event)) {
      analyticsPurchaseEvents++
      purchaseOccurrences.push({source:'analytics',orderId:normalizeOrderId(e.properties?.orderId),sessionId:e.sessionId,timestamp:time(e)})
      purchaseSessions.add(e.sessionId)
      if (e.properties?.orderId) purchaseOrderKeys.add(String(e.properties.orderId))
    }
  }
  const purchaseTotals = uniquePurchases(purchaseOccurrences)
  // Match Explore > Events: headline Purchase Events counts only standard analytics `purchase` records.
  // Behavioral `purchase_completed` signals are still used for cart-journey evidence.
  const purchaseEvents = analyticsPurchaseEvents
  let overlappingSessions = 0
  for (const [sessionId, streamUnsorted] of legacyStreams) {
    const stream = streamUnsorted.sort((a,b) => time(a)-time(b))
    const firstCart = stream.find(e => LEGACY_CART.has(e.event))
    if (!firstCart) continue
    if (strictSessions.has(sessionId)) { overlappingSessions++; continue }
    const after = stream.filter(e => time(e) >= time(firstCart))
    const hasCheckout = after.some(e => LEGACY_CHECKOUT.has(e.event))
    const hasPurchase = after.some(e => LEGACY_PURCHASE.has(e.event))
    const friction = after.filter(e => FRICTION_KINDS.has(e.event))
    const status = hasPurchase ? 'purchase_recorded' : hasCheckout ? 'checkout_no_purchase' : 'cart_no_checkout'
    const timeline = after.slice(0,80).map((e,i) => ({eventId:String(e._id || e.eventId || `legacy-${i}`),kind:e.event,label:LABELS[e.event] || e.event,time:e.timestamp,path:e.path || '/',cartId:null,element:null,code:null}))
    cases.push({sessionId,visitorId:null,userId:firstCart.userId || null,device:firstCart.deviceInfo?.deviceType || 'Unknown',cartId:null,source:'analytics',evidence:'Session-level add_to_cart event; cart identity and item count were not recorded',firstCartAt:firstCart.timestamp,lastSeenAt:stream[stream.length-1].timestamp,status,checkoutObserved:hasCheckout,purchaseObserved:hasPurchase,frictionCount:friction.length,lastPath:stream[stream.length-1].path || '/',eventCount:after.length,timeline,hasReplay:false})
  }
  cases.sort((a,b)=>time({timestamp:b.firstCartAt})-time({timestamp:a.firstCartAt}))
  const counts = {cartSessions:cases.length,checkoutObserved:0,purchaseRecorded:0,cartNoCheckout:0,checkoutNoPurchase:0,cartEmptied:0,frictionSessions:0,behaviorSessions:strictSessions.size,analyticsOnlySessions:cases.length-strictSessions.size}
  for(const c of cases) {
    if(c.checkoutObserved)counts.checkoutObserved++
    if(c.purchaseObserved)counts.purchaseRecorded++
    if(c.status==='cart_no_checkout')counts.cartNoCheckout++
    if(c.status==='checkout_no_purchase')counts.checkoutNoPurchase++
    if(c.status==='cart_emptied')counts.cartEmptied++
    if(c.frictionCount)counts.frictionSessions++
  }
  const matchedCartPurchaseSessions = new Set(cases.filter(c => c.purchaseObserved).map(c => c.sessionId))
  counts.allTrackedPurchaseSessions = purchaseSessions.size
  counts.purchaseWithoutMatchedCart = [...purchaseSessions].filter(id => !matchedCartPurchaseSessions.has(id)).length
  const validStatuses = new Set(['all','cart_no_checkout','checkout_no_purchase','cart_emptied','purchase_recorded'])
  const safeStatus = validStatuses.has(status) ? status : 'all'
  const filteredCases = safeStatus === 'all' ? cases : cases.filter(c => c.status === safeStatus)
  counts.purchaseEventOccurrences = purchaseEvents
  return {counts,cases:filteredCases.slice(offset,offset+limit),totalCases:cases.length,filteredCases:filteredCases.length,diagnostics:{behaviorEventsScanned:normalized.length,analyticsEventsScanned:legacyIds.size,analyticsCartEvents,overlappingSessions,behaviorCartSessions:strictSessions.size,analyticsOnlyCartSessions:cases.length-strictSessions.size,behaviorPurchaseEvents,analyticsPurchaseEvents,purchaseEventOccurrences:purchaseEvents,rawPurchaseEventOccurrences:purchaseTotals.rawCount,distinctPurchaseSignalsAcrossStreams:purchaseTotals.count,duplicatePurchaseSignals:purchaseTotals.duplicatesRemoved,purchaseFallbackMatches:purchaseTotals.fallbackMatches,distinctOrderIdsWithPurchaseEvent:purchaseOrderKeys.size},definitions:{purchaseEventOccurrences:'Count of standard analytics purchase events in the selected reporting window, matching Explore > Events. Behavioral purchase_completed signals are used for journey evidence but not added to this total; not verified payments.',allTrackedPurchaseSessions:'Unique session IDs containing a purchase_completed or purchase event anywhere in the selected period, even when no preceding cart event is available. Not verified orders.',purchaseWithoutMatchedCart:'Purchase sessions without a matched cart-to-purchase journey. May be due to missing earlier cart telemetry, different sessions, or incomplete event coverage.',purchaseRecorded:'Purchase events found after a qualifying cart event in the same session (matching cart ID when present). Not all purchase events or verified payments.',cartSessions:'Distinct sessions with a positive-item cart update, or a legacy add_to_cart event. Legacy events have no verified cart ID.',checkoutObserved:'Checkout recorded after a cart event in the same session; when a cart ID exists, checkout must match that cart.',cartNoCheckout:'No checkout event found after cart activity in the observed session; not proof of abandonment.',checkoutNoPurchase:'Checkout observed without a subsequent tracked purchase event in the session.',cartEmptied:'An identified cart was emptied without a recorded purchase.',frictionSessions:'Sessions with explicitly captured friction after cart activity.',replay:'Replay is offered only when a recording is stored. Historical analytics-only cases can have recordings.',source:'Behavior cases have verified cart identity. Analytics-only cases have a recorded add_to_cart event but no cart ID; their checkout and purchase steps are session-level observations, not confirmed same-cart outcomes.'}}
}
module.exports={investigateCart}
