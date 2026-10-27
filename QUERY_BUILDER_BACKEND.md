# Dev Day Query Builder backend

This change adds a project-scoped API for the Explore → Query Builder tab.

## Endpoints

All endpoints require the active project ID in `X-Project-Id`. The existing `requireProject` middleware validates the project and the router always scopes reads to `req.projectId`.

- `POST /api/explore/query-builder/execute` — executes an event query and returns grouped counts, revenue, unique sessions/users, and percentage share.
- `GET /api/explore/query-builder/saved` — lists saved queries for the selected project.
- `POST /api/explore/query-builder/saved` — saves a named query definition for the selected project.
- `DELETE /api/explore/query-builder/saved/:id` — deletes a saved query only within the selected project.

## Request body for execute

```json
{
  "definition": {
    "event": "purchase",
    "groupBy": "Platform",
    "timeRange": "Last 30 days",
    "logic": "AND",
    "conditions": [
      { "field": "country", "operator": "is", "value": "India" }
    ],
    "groups": [
      {
        "logic": "OR",
        "conditions": [
          { "field": "event", "operator": "is", "value": "add_to_cart" },
          { "field": "event", "operator": "is", "value": "purchase" }
        ]
      }
    ]
  }
}
```

The selected event is the primary event being measured. Nested groups combine with the top-level condition set using the top-level `logic` setting. All user-provided fields/operators are checked against explicit allowlists; user input is never accepted as a raw MongoDB query. Query execution is limited to 20 seconds, the date range to 90 days for the UI's supported presets, and the result set to 100 groups.

## Deploy

1. Deploy the updated `vision-engine` source to the existing Render service, keeping the current environment variables (especially `MONGO_URI`).
2. Deploy the updated dashboard to the intended Firebase Hosting site.
3. Select a project in the dashboard and run a query. Saved queries are stored in MongoDB and isolated by project.

No environment variable or third-party dependency is added. The `SavedExploreQuery` collection is created by Mongoose when the first saved query is inserted.
