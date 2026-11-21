# Vision Engine DevDay — 100 existing users / six-month synthetic journey seeder

This is a **synthetic test-data generator**, not live customer history. It was designed against the supplied `models/Event.js`, `models/User.js`, Revenue Opportunity Radar, revenue trend, At-a-Glance, Ask Vivi code, and the provided event-schema JSON.

## What it does

- Selects **100 distinct existing users** from `users` (project-scoped plus legacy `projectId:null`), sorted by `createdAt` descending. It **does not create or update user accounts**.
- Loads products from the supplied **100-product ecommerce catalogue** with `--catalog` (or falls back to item metadata from project events when no catalog is passed) (`add_to_cart`, `select_item`, `checkout_start`, `view_cart`, `purchase`). At least eight distinct products with valid IDs, names, and prices are required. It will fail rather than invent missing catalog products.
- Generates up to ~13,000 chronological simulated events over **183 days**, with repeated sessions, daily/week-to-week variability and periods of higher/lower purchases. The actual number depends on seed options and catalogue.
- Gives **25 of the 100 users** assigned non-Indian country/city data, distributed across UK, US, UAE, Singapore, and Germany. The other 75 are assigned Indian cities. This is **25% of user identities**, not guaranteed 25% of event records (repeat visitors generate different counts).
- Uses the exact schema fields required by current analytics: `event`, `userId`, `sessionId`, `projectId`, `timestamp`, `properties`, `deviceInfo`, plus `path`/`url`. Purchase events include valid `orderId`, `properties.total` (decimal string), `properties.currency` and `properties.products[]` with `productId`, `productName`, `productPrice`, `productQuantity`. Cart steps have a shared `cartId` and stable product identifiers.
- Includes product opportunities (viewed frequently, rarely added), cart removals, checkout exits, stronger desktop conversion, zero-result searches, product stock issues and occasional payment failures.
- **Does not generate the seven dummy event names** you asked us to ignore, or heatmap mouse movements.
- Assigns deterministic `_id` values and upserts with `$setOnInsert`, so repeating the same `--batch`, `--end`, `--days`, project, user selection and catalogue does not duplicate events.
- Supports dry runs, an auditable JSON preview, verification, and targeted cleanup of only this batch.

## What it does NOT do

- **Not a complete Decision Intelligence implementation.** This supplies relevant events for your existing modules. A new Decision Intelligence UI, API, recommendation scoring and workflow tracking must still be implemented.
- **No session replay recordings** or `sessions.chunks` are fabricated. The Session Replay player won't play these synthetic sessions.
- **No actual payment settlements** are recorded. `purchase` is a client-side analytics event.
- Does not modify `users.createdAt`, names, passwords, email addresses, existing `events`, or existing purchase amounts. Synthetic historical events may be **older than a chosen account's actual creation date**: this is deliberate simulation to produce a full six-month timeline, not faithful historical behaviour. Do not treat the generated user history as genuine.
- Does not automatically refresh Ask Vivi rollups/caches/analytics snapshots. If you previously enabled materialized daily rollups or Redis caching, rebuild/invalidate them after the seed.
- Does not guarantee all module calculations will render correctly: that depends on your deployed backend version, filters, 30k event cap, project settings, and whether live data is mixed with synthetic data.
- Source event samples sometimes omit currency. **You must explicitly supply the correct currency** for generated prices; do not assume INR/GBP/USD based on geography.

## Setup

Copy `seed-vision.js` and `sample-events.json` together to a `scripts/` folder in your **vision-engine backend**, which already has `mongoose` installed. The `sample-events.json` file is used only with `--fixture` for offline tests and is not loaded during real database operations. It contains product-level sample details only (no exported customer identity or shipping addresses).

Set `MONGO_URI` in your terminal environment pointing to the correct DevDay database. The script also accepts `MONGODB_URI` or `--mongo-uri`, but does not print or store credentials.

### 1. Offline sanity check (no database connection)

```bash
node scripts/seed-vision.js --fixture --project vis_fixture --currency USD --count 100 --days 183 --end 2026-11-21
```

### 2. Actual DRY RUN (connects to database, **no writes**)

```bash
node scripts/seed-vision.js \
  --project vis_6bcd1aef732e0d5d \
  --currency YOUR_VERIFIED_CURRENCY \
  --count 100 --days 183 --end 2026-11-21 \
  --batch devday_decisions_v1 \
  --output ./vision-seed-preview.json
```

`--end` is **exclusive UTC**: `2026-11-21` covers events through `2026-11-20`. If the date is now later, choose an appropriate fixed boundary. Review the preview, particularly the day-by-day revenue graph and product scenarios. The script will stop if there are fewer than 100 eligible users or 8 usable products.

### 3. Insert synthetic events only after checking preview

```bash
node scripts/seed-vision.js \
  --project vis_6bcd1aef732e0d5d \
  --currency YOUR_VERIFIED_CURRENCY \
  --count 100 --days 183 --end 2026-11-21 \
  --batch devday_decisions_v1 --apply
```

`--apply` requires `--end` so repeated runs do not accidentally shift the date window. Re-running the same command should report `inserted: 0` if all records already exist.

### 4. Verify and optionally clean up the exact batch

```bash
node scripts/seed-vision.js --project vis_6bcd1aef732e0d5d --batch devday_decisions_v1 --verify
```

```bash
node scripts/seed-vision.js --project vis_6bcd1aef732e0d5d --batch devday_decisions_v1 --cleanup --apply --confirm-batch devday_decisions_v1
```

The cleanup deletes **only** `{projectId, seedBatchId, isSynthetic:true}` documents in `events`. It does not delete real events or user accounts. Consider backing up the database before any write.

## Database / Compass verification queries

```javascript
// Counts by type for this synthetic batch only.
db.events.aggregate([
  {$match:{projectId:'vis_6bcd1aef732e0d5d',isSynthetic:true,seedBatchId:'devday_decisions_v1'}},
  {$group:{_id:'$event',count:{$sum:1}}},
  {$sort:{count:-1}}
]);

// Six-month synthetic revenue buckets (server uses the same properties.total convention).
db.events.aggregate([
  {$match:{projectId:'vis_6bcd1aef732e0d5d',isSynthetic:true,seedBatchId:'devday_decisions_v1',event:'purchase'}},
  {$group:{_id:{$dateToString:{format:'%Y-%m',date:'$timestamp'}},revenue:{$sum:{$convert:{input:'$properties.total',to:'double',onError:0,onNull:0}}},orders:{$sum:1}}},
  {$sort:{_id:1}}
]);

// Exact synthetic user-country assignment, deduplicated by userId.
db.events.aggregate([
  {$match:{projectId:'vis_6bcd1aef732e0d5d',isSynthetic:true,seedBatchId:'devday_decisions_v1'}},
  {$group:{_id:'$userId',country:{$first:'$deviceInfo.geo.country'}}},
  {$group:{_id:'$country',users:{$sum:1}}},
  {$sort:{users:-1}}
]);
```

## Which frontend modules benefit?

| Module | Synthetic coverage | Limitations |
|---|---|---|
| Project Overview & At a Glance | page view / product / cart / checkout / purchase / device sessions | API query performance and caps remain unchanged |
| Revenue Trend & By Persona | Purchase totals, six-month variable revenue, first/repeat purchasing cohorts | Revenue totals are simulated; existing historic purchases are also counted |
| Revenue Opportunity Radar | High-interest/low-cart product, cart non-purchase sessions, checkout progression | Recommendations should be interpreted as exploratory simulated scenarios |
| Revenue Investigator | Tracked revenue and purchase changes across periods | Not settled sales, no refunds, generated currencies must be consistent |
| Explore / Funnels / Journey Comparison | Ordered event stages within distinct session IDs | Not a confirmed cross-session cart journey |
| Product Intelligence | Views, additions, removals and itemized purchases with consistent product IDs | No inventory-system truth |
| Audience & Device | 25 external-country identities, other Indian identities; mobile conversion difference | Country assignments are simulated and not geolocated from actual IP |
| Ask Vivi | Product, cart, revenue, geography, user spending and basic intent questions | It only works with question handlers available in your deployed code |
| Session Replay | No synthetic recordings | This is deliberately left untouched |
| Decision Intelligence (future) | Testable scenarios: product interest, cart exits, mobile friction, search failures, payment errors | Must build recommendation rules/UI; simulated flags should be displayed |

## Operational notes

1. **Do not hide simulation:** Make the dashboard clearly say "Includes synthetic DevDay events" for this project or add an `Include synthetic data` filter. Otherwise the UI mixes real and simulated values without distinction.
2. Existing `events` indexes on `(projectId, timestamp)` and `(projectId, event, timestamp)` are already present in your example index list. The script uses batched upserts (~300 per batch); you don't need to create more indexes just to seed.
3. The current Opportunity Radar uses all matching project events and limits at 50,000; the Ask Vivi in-memory path may cap at 30,000. Adding ~13,000 events can trigger limits for six-month queries **even though the seed is correct**. Use optimized aggregate or daily-rollup endpoints for longer windows.
4. If product names or prices in the real event collection are inconsistent, inspect the preview and catalogue before applying. The seeder does not use the placeholder `data/products.js` from the supplied backend archive.
5. New synthetic events `checkout_step_error`, `payment_failed`, `product_stock_unavailable`, `search_result_click`, `coupon_applied` are for future Decision Intelligence. To collect real occurrences, add matching SDK instrumentation and server validation; the seeder alone does not add frontend tracking.
6. Re-running with a different selected user set or updated source catalogue can change the deterministic event content. Existing upserts are not overwritten. For a truly clean regeneration, remove the specific batch and regenerate under a new batch ID.

## Actual ecommerce catalogue (`products.js`) — preferred

This package includes the user-supplied `products(2).js` (renamed to `products.js`), containing **100 catalogued products** with realistic USD prices and `export const products = [...]` syntax. The loader reads the literal array as data without executing the module. Product #4 (Sennheiser Audio Series-325) and #55 (Apple iPhone 13 Pro Max) match examples in the supplied analytics event schema. The live database will be checked for conflicting product names and prices during the dry run.

Copy `seed-vision.js` and the bundled `products.js` into the backend `scripts` directory. Always pass `--catalog scripts/products.js` to avoid failing to reconstruct full product records from recent events.

### Catalogue dry run (real database, no writes)

```bash
node scripts/seed-vision.js \
  --catalog scripts/products.js \
  --project vis_6bcd1aef732e0d5d \
  --currency USD --count 100 --days 183 \
  --end 2026-11-21 --batch devday_catalog_v2 \
  --output ./vision-catalog-preview.json
```

Inspect the preview's `catalogMismatches`, revenue and scenario summaries first. **If mismatches exist, resolve them before applying; do not use `--allow-catalog-mismatch` casually**. Existing history and synthetic events would otherwise attribute the same product IDs to different goods.

### Insert after review

```bash
node scripts/seed-vision.js \
  --catalog scripts/products.js \
  --project vis_6bcd1aef732e0d5d \
  --currency USD --count 100 --days 183 \
  --end 2026-11-21 --batch devday_catalog_v2 --apply
```

### Verify

```bash
node scripts/seed-vision.js --project vis_6bcd1aef732e0d5d --batch devday_catalog_v2 --verify
```

The files are synthetic testing material. Reported event volumes and revenue are **not** real customer behaviour. Use the supplied `test-seeder.js` and `test-catalog.js` for offline validation; `--fixture` uses dummy users and never writes to MongoDB.
