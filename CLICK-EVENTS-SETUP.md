# Click-event backend setup

Event management is open. No admin authentication or VISION_ADMIN_KEYS setting is required. The selected project ID is supplied automatically by the dashboard. Keep MONGO_URI and the project’s allowed website origins configured.

Picker tickets retain origin, project, nonce, and expiry validation using an automatically generated server signing key. Reopen a picker after restarting the backend. Multiple replicas may optionally share VISION_PICKER_SIGNING_KEY; this does not introduce authentication.

Deploy this backend with the updated dashboard. The existing EventDefinition (projectId, name) unique index remains required. The optional tracking field needs no migration. Dashboard VITE_API_BASE_URL and SDK data-api-url must point at the same backend.
