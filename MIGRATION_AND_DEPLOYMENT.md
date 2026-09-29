# Migration and deployment checklist

## 1. Existing Dev Day data must be assigned to a project

After adding `projectId` to events/sessions, old records without a project id will intentionally not appear in project-scoped dashboards.

Use the included migration script after creating the project you want the original demo data to belong to:

```bash
PROJECT_ID=vis_your_project_id \
MONGO_URI='your-mongo-uri' \
MIGRATE_USERS=true \
node scripts/migrateProjectScope.js
```

Review the result, then synchronize indexes:

```bash
PROJECT_ID=vis_your_project_id \
MONGO_URI='your-mongo-uri' \
MIGRATE_USERS=true \
SYNC_INDEXES=true \
node scripts/migrateProjectScope.js
```

`syncIndexes()` is important because older schemas created global unique indexes such as:
- `sessions.sessionId`
- `eventdefinitions.name`
- `insightsnapshots.window`
- `users.email`
- `users.userId`

Those global unique indexes must be replaced by project-scoped compound indexes for true multi-project operation.

Take a database backup before running index synchronization against production data.

## 2. Dashboard requests

The updated frontend API client should send:

```http
X-Project-Id: vis_...
```

for dashboard analytics requests.

Project-management routes deliberately do not require an active project:

```text
POST   /api/admin/projects
GET    /api/admin/projects
GET    /api/admin/projects/:projectId
PATCH  /api/admin/projects/:projectId
DELETE /api/admin/projects/:projectId
```

All analytics routes registered after `router.use(requireProject)` do require the header.

## 3. Hosted Vision SDK — normal event ingestion

The SDK should read `data-project-id` from its script tag and send it with every batch.

Recommended request:

```js
fetch('https://YOUR_API/api/events', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Project-Id': projectId,
  },
  body: JSON.stringify({ projectId, events }),
})
```

The backend treats the validated request project as authoritative and overwrites event-level project ids.

## 4. rrweb/session replay ingestion

The body is compressed binary, so `requireProject` cannot read `projectId` from inside the payload before validation.

For normal `fetch`, use a header:

```js
fetch(`${RECORD_API}/ingest`, {
  method: 'POST',
  headers: { 'X-Project-Id': projectId },
  body: blob,
  keepalive: true,
})
```

For `navigator.sendBeacon`, custom headers cannot be set. Put the id in the URL:

```js
navigator.sendBeacon(
  `${RECORD_API}/ingest?projectId=${encodeURIComponent(projectId)}`,
  blob
)
```

The backend supports both methods.

## 5. Allowed origins

The Project document controls which website may submit tracking data:

```json
{
  "allowedOrigins": [
    "https://shop.example.com",
    "http://localhost:5173"
  ]
}
```

If you test a production-domain project from localhost, add the localhost origin to the project or create a separate development project.

## 6. Backend environment

`ALLOWED_ORIGINS` is now for the Vision **dashboard** origins, not every customer tracking site.

Example:

```env
ALLOWED_ORIGINS=https://dashboard.example.com,http://localhost:5173
MONGO_URI=mongodb+srv://...
MONGO_MAX_POOL_SIZE=20
```

Tracked-site origins are checked dynamically using `Project.allowedOrigins`.

## 7. Demo auth

When the demo ecommerce site's `/api/auth/signup` and `/api/auth/login` calls become project-aware, send the same `X-Project-Id` header. Requests without it remain in the legacy `projectId:null` tenant for backwards compatibility.

## 8. Production hardening still recommended

Before treating this as a public SaaS rather than a Dev Day demo:
- add dashboard user authentication
- add project owner/member authorization
- add ingestion rate limiting / abuse protection
- consider retention/TTL policies for high-volume mouse-move events
- consider pre-aggregated daily rollups when raw event volume becomes large

## 9. Legacy user fallback

Session replay user lookups are strictly project-scoped by default. This avoids a user profile from a legacy/global tenant being shown inside another project.

Migrate existing users with `MIGRATE_USERS=true`. If you temporarily need the old fallback while migrating, set:

```env
ALLOW_LEGACY_USER_FALLBACK=true
```

Remove that flag after migration.

## 10. Verify migration

A read-only verification script is included:

```bash
MONGO_URI='your-mongo-uri' \
PROJECT_ID=vis_your_project_id \
node scripts/verifyProjectScope.js
```

After migration, `events`, `sessions`, `eventdefinitions`, and `insightsnapshots` should report `legacy/unscoped=0`. `users` should also be zero when `MIGRATE_USERS=true` was used.
