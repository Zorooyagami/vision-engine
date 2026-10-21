# Product Intelligence API

See the dashboard README for the feature overview. The new route is `GET /api/analytics/products`; it is project-scoped by the existing analytics router and supports the current period, platform, device and persona query filters.

It returns KPI metrics, product leaderboards, search term rankings, heuristic product-interest opportunities and a coverage flag. Purchases are aggregated from `properties.products[]`; search queries are ranked independently because current search events do not attribute a query to a specific product.

The service uses the existing `data/products.js` catalogue to enrich missing product metadata where possible. A 50,000-event request cap is reported through `coverage.capped`.
