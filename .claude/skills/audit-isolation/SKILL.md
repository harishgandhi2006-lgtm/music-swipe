---
name: audit-isolation
description: Audits SQL queries and API routes to ensure strictly isolated per-user feeds.
---
# Strict Feed Isolation Audit

When this skill is invoked:
1. Inspect all route handlers in `backend/routes/` and database queries in `backend/db.js`.
2. Verify that every SQL query filtering or returning user affinity scores, history, or preferences scopes strictly by `req.userId` / authenticated session token.
3. Ensure no collaborative filtering or shared cross-user aggregation tables are referenced.
4. Flag any route accepting a foreign `userId` in parameters or payload.
