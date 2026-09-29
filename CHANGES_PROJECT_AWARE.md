# Vision backend — project-aware refactor

This source was reviewed for multi-project isolation, query performance, ingestion safety, replay correctness, and obvious backend bugs.

## Main changes

### 1. Project isolation is now part of the stored data
The following collections now carry `projectId` and use project-first indexes:

- `events`
- `sessions`
- `eventdefinitions`
- `insightsnapshots`
- `users` (transitional: optional for old demo users)

All dashboard analytics queries were updated to resolve or receive the active project and filter by it.

### 2. Ingestion now validates project + tracked-site origin

`POST /api/events`
- requires a valid project (`X-Project-Id`, `?projectId=`, or JSON top-level `projectId`)
- validates the browser `Origin` against `Project.allowedOrigins`
- overwrites any event-level `projectId` with the validated server-side project id
- respects the project's Analytics / Heatmaps settings
- updates `Project.lastEventAt`

`POST /api/record/ingest`
- requires a valid project
- validates origin
- scopes replay upserts by `{ projectId, sessionId }`
- respects Session Replay settings
- updates `Project.lastEventAt`

### 3. CORS now supports a hosted SDK safely
The previous global CORS allow-list would block SDK calls from every customer website not present in `ALLOWED_ORIGINS`.

Now:
- `/api/events` and `/api/record/ingest` can pass browser CORS from arbitrary sites
- those requests are then checked against that project's `allowedOrigins`
- dashboard/read APIs remain restricted to `ALLOWED_ORIGINS`

### 4. Session Replay routing bug fixed
`routes/record.js` contained duplicate routes, including an unprotected ingest route and dashboard GET routes incorrectly using `checkOrigin`.

It now has one canonical route for each endpoint:
- SDK ingest: `requireProject + checkOrigin`
- dashboard reads: `requireProject` only

### 5. Analytics/persona helpers are project-scoped
Project scoping was added through:
- funnels
- revenue trend
- revenue by persona
- persona leaderboard
- event catalog/details
- journey paths/flow
- KPI endpoints
- legacy stats endpoints
- heatmaps
- session replay lists
- AI insight fact generation + stored snapshots

Persona priority is consistently applied as:
`loyal > firsttime > active`, with guest handled separately.

### 6. Query/index improvements
`Event` indexes now start with `projectId`, for example:
- `{ projectId, timestamp }`
- `{ projectId, event, timestamp }`
- `{ projectId, userId, timestamp }`
- `{ projectId, sessionId, timestamp }`
- `{ projectId, path, event, timestamp }`

The Event Catalog N+1 query pattern was replaced with aggregate queries for event metrics and sparklines.

Journey revenue no longer performs one purchase query per discovered path. Revenue is fetched once per session and reused.

KPI calculation uses a single `$facet` aggregation rather than separate full scans for purchases, sessions and users.

### 7. Correctness fixes
- `personaLeaderboard.js` was empty; it now uses the same persona revenue source as the Revenue page.
- Revenue trend bucketing had an unconditional early `return`, so the intended hour/day/week/month logic was unreachable. Fixed.
- Device names are normalized consistently (`desktop` -> `Desktop`, etc.).
- Custom date ranges treat a date-only `to` value as inclusive by querying to the next-day exclusive boundary.
- Heatmap reads now support period, platform/device, persona and optional exact `path` filtering.
- Event detail property samples are project/window scoped.
- Project deletion removes the project's events, replays, event definitions, insight snapshots and project-scoped demo users.
- Mongo connection logging no longer prints a credential-bearing connection URI.

### 8. AI insights are project-specific
Insight snapshots now use a unique `{ projectId, window }` key.
Generation-in-progress state is tracked per project instead of globally.

### 9. Demo auth hardening
New passwords are hashed with Node's built-in `crypto.scrypt` (no new npm dependency).
Existing plaintext demo passwords continue to work and are upgraded to scrypt on successful login.
Auth supports project-aware users when a project id is supplied, while keeping `projectId:null` compatibility for the old demo flow.

## Removed
- `services/funnel copy.js` — unused duplicate
- `controllers/eventSummary.js` — unused/broken standalone helper

## Important remaining production concern
A public Vision `projectId` is intentionally not a secret. Project scoping prevents accidental cross-project queries, but it is **not dashboard authorization**.

The current project-management/dashboard API still needs real user authentication + membership checks before this is exposed as a production multi-customer SaaS. For the Dev Day demo, the current project context is sufficient for data separation.

### 10. Additional consistency/performance pass
- `active` persona now means a known/logged-in user with activity in the selected period, excluding loyal and first-time users. This keeps persona definitions exhaustive and mutually exclusive even when no explicit `login` event was emitted during the window.
- Legacy `/api/stats/events/personas` segmentation now uses the same `loyal > firsttime > active > guest` priority instead of overlapping users across persona buckets.
- The legacy KPI persona resolver now delegates to the same shared persona helper instead of maintaining a second, inconsistent definition.
- `/api/record/recorded-users` now groups directly in MongoDB instead of loading every session/chunk into Node and regrouping in memory.
- Replay list queries project only page/receivedAt metadata and never load compressed rrweb bytes.
- Replay decompression now uses Node `zlib` directly, caps decompressed output at 20 MB, and no longer needs `fflate` just to decode UTF-8 on the backend.
- Legacy/global user profile fallback in replay is disabled by default to prevent cross-project profile leakage. It can be enabled temporarily with `ALLOW_LEGACY_USER_FALLBACK=true` while migrating users.
- Project deletion disables the project before cascading deletes, so ingestion stops immediately and a failed cleanup remains retryable rather than leaving an already-deleted project with orphaned data.
- AI insight persona wording was aligned with the actual backend definitions, and the response schema now matches the prompt's 4–6 insight requirement.
- Funnel correctness was tightened: the direct PLP funnel now requires `add_to_cart` to originate from `/products`, while the PDP funnel requires `product_view` and `add_to_cart` on `/products-detail/...`. Previously a PDP journey could also be counted as the direct funnel because the matcher ignored page/path context.
- Unknown `/api/...` routes now return JSON 404 responses instead of Express' HTML `Cannot GET/POST ...` page, which keeps the shared frontend `apiClient` error handling predictable.
