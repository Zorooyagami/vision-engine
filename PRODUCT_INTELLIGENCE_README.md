# Product Intelligence API

See the dashboard README for the feature overview. The new route is `GET /api/analytics/products`; it is project-scoped by the existing analytics router and supports the current period, platform, device and persona query filters.

It returns KPI metrics, product leaderboards, search term rankings, heuristic product-interest opportunities and a coverage flag. Purchases are aggregated from `properties.products[]`; search queries are ranked independently because current search events do not attribute a query to a specific product.

The service uses the existing `data/products.js` catalogue to enrich missing product metadata where possible. A 50,000-event request cap is reported through `coverage.capped`.


## Audience Intelligence API

`GET /api/analytics/audience?period=30d` returns project-scoped unique-session breakdowns for device type, operating system, browser, platform, language, country, and city. It also returns approximate city-level map points from `deviceInfo.geo.latitude` / `longitude`. Supported periods follow the existing analytics filter helper (`1d`, `7d`, `30d`, `90d`, `180d`, or `custom` with `from` and `to`). Raw event count is reported separately; the audience metrics deduplicate on `sessionId` so high-frequency events (for example `heatmap_move`) do not inflate the counts. IP addresses are not returned to the dashboard.

## Product opportunity scenario estimates

Product opportunities include impact, confidence, effort, and an illustrative upside range. The range assumes a 1%-3% incremental conversion improvement over observed product views and uses the current listed product price as a proxy for order value. It is a scenario for prioritization, not a revenue forecast or promise. Products without a known price omit the range.
