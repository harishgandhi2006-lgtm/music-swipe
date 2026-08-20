# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Music Swipe Context
- **Architecture:** Full-stack platform featuring a gesture-based user interface.
- **Backend:** Infrastructure built with a SQLite database layout via node:sqlite (Node's built-in synchronous SQLite module).
- **Security:** JWT authentication is used for session management.

* Git: Never append "Co-authored-by" trailers to commit messages. All commits must be made strictly under the user's local git configuration with absolutely no AI attribution or tagging.

## Commands

Run from the repo root unless noted.

```bash
npm run install:all       # install backend + frontend deps
npm run dev:backend       # backend on :3001, auto-restart (node --watch)
npm run dev:frontend      # frontend on Vite dev server, proxies /api to :3001
npm run build              # vite build -> frontend/dist (served by backend in prod)
npm start                  # start backend only (production mode)
```

Backend tests (from `backend/`):

```bash
npm test                                        # node --test, all backend/test/*.test.js
node --test --import=./test/setup.js test/rerank.test.js   # single test file
npm run simulate                                # offline recommender simulator, no Deezer calls
npm run simulate -- --scenario=hot-streak --swipes=200     # specific scenario
```

`test/setup.js` is loaded via `--import` before any other module, and points `MUSIC_SWIPE_DB` at a throwaway temp file — this is what stops tests from touching the real `backend/music_swipe.db`. Any new test entry point must load it the same way or it will corrupt the real database.

There is no frontend test suite. For UI changes, run `npm run dev:frontend` + `npm run dev:backend` and exercise the flow in a browser (or via the `run` skill).

A `PostToolUse` hook (`.claude/settings.json`) runs `npm test --if-present` after every Write/Edit/MultiEdit, so backend logic changes get tested automatically — don't skip investigating a red run.

## Architecture

**Two independent npm workspaces**, not a monorepo tool: `backend/` (Express + node:sqlite, ESM) and `frontend/` (React 18 + Vite + Tailwind + framer-motion). The backend serves `frontend/dist` as static files in production (see `backend/server.js`); in dev they run as separate processes with Vite proxying API calls.

### Backend request flow

`server.js` mounts routers in a specific, load-bearing order:
```
/api/auth        auth.js         register/login/me (JWT issuance)
/api/tracks      tracks.js       GET /next — the swipe feed
/api/interactions interactions.js like/reject, undo, history, liked archive, genre scores
/api/proxy       proxy.js        signed Deezer audio stream proxy
/api              public.js      unauthenticated public-preview route (for share links)
/api              profileRouter  requireAuth applied via router.use() to everything
```
`publicRouter` **must** stay mounted before `profileRouter` — `profileRouter` calls `router.use(requireAuth)` with no path, which intercepts every request reaching that router before Express even checks for a matching route, making anything sharing the `/api` prefix mounted after it unreachable.

**Auth model is dual-mode.** Most routes accept either a JWT (`Authorization: Bearer <token>`, decoded to a real `userId`) or fall back to an anonymous identity (`x-user-id` header, defaulting to the string `'default'` if absent) — see `getAuthInfo()` in `interactions.js` and `getUserId()` in `tracks.js`. Routes that touch personal data users could otherwise read cross-account (`/liked`, `DELETE /interactions/:trackId`, profile) use `requireAuth` instead and refuse the anonymous fallback, specifically to avoid leaking or mutating the shared `'default'` bucket. When adding a new interactions/profile route, decide deliberately which mode it needs — don't default to the permissive one out of habit.

**Share links carry zero server-side linkage.** `frontend/src/share.js` builds a URL with just a track id and optional note, no association written to the DB (see `public.js`'s public-preview route). This is a specific data-isolation guarantee — see below — not just a design choice; don't add tracking, referrer ids, or sender ids to share links.

**Audio is proxied, never linked directly.** Deezer preview URLs are signed and short-lived, so `preview_url` in API responses is always our own `/api/proxy/audio?trackId=` route, which resolves and re-signs on demand (`services/preview.js`) and re-validates the resolved host against a Deezer CDN allowlist before piping the stream — this is what stops the proxy from becoming an open relay.

### The recommendation engine (`backend/services/recommender.js`, ~1200 lines)

This is the architectural core of the backend and is governed by a hard policy documented in `.claude/skills/strict-isolation/SKILL.md`: **individual-input-only**. Every scoring term must be a function of (a) this user's own swipes, or (b) Deezer's own public track rank — never another user's data, a friend graph, or any aggregate across this app's users. `db.js` contains migrations that actively `DROP TABLE` on any leftover collaborative-filtering, friend-graph, or crowd-signal tables (`user_neighbors`, `friendships`, `shared_items`, `track_stats`, etc.) — this is enforced, not aspirational. `__test_weights` is exported specifically so a test can assert no CF/social term is ever reintroduced. Before touching this file, load the `strict-isolation` skill.

Key structures/flows, in case you need to trace behavior:
- **Per-user in-memory pool** (`getPool`, module-level `Map<userId, {...}>`): queued-but-unserved tracks, an LRU-evicted cache bounded by a pool-count budget, since it isn't persisted across restarts. `hydrateRecent` replays a user's last few real swipes from the DB to rebuild the fatigue window after a restart, since the in-memory pool doesn't survive one.
- **Fatigue/diversity caps** (`__test_fatigue`, `violatesDiversity`): bound how often the same artist/album/genre can recur within a recent window, checked both at queue time and again at serve time (reordering can put two same-artist tracks back-to-back even if the queue order was fine).
- **Desirability prior** (`__test_desirability`): blends Deezer's own popularity rank into scoring.
- **Session momentum** (`__test_momentum`): a small, deliberately bounded tilt toward whatever the user is reacting to *right now*, layered on top of (never replacing) the long-term affinity profile. The bound is asserted in `momentum.test.js`.
- **Affinity scores** (`__test_affinity`, and `affinityScore` in `db.js`): symmetric-Laplace-smoothed like/reject ratio per genre/artist, chosen so "no evidence" and "one like, one reject" both land at exactly 0.5 — see the large comment above `affinityScore` in `db.js` before changing the formula, since thresholds elsewhere (`getTopGenres`, `getTopArtists`) are calibrated against that exact crossover point.
- **Per-user weight overrides** (`effectiveWeights`, `effectiveEpsilon`): user-adjustable genre/artist emphasis sliders (`user_preferences` table), structurally limited to redistributing existing signal weights — cannot introduce a new signal, by construction of the return shape.
- Entry points other modules call: `getNextTrack(userId)`, `warmPool(userId)`, `updateAffinityScores(userId, trackId)`.

Because scoring bugs here tend to be invisible in a unit test (they show up as a feed collapsing into one genre over ~100 swipes, not as a single wrong value), use `npm run simulate` after any change to weights, caps, or momentum — it runs the real serve-time code path (`getNextTrack`/momentum/caps) against a synthetic catalogue and reports genre distribution, run lengths, and exploration rate over a long session.

### Database (`backend/db.js`)

Single `node:sqlite` `DatabaseSync` connection, WAL mode, schema created with `CREATE TABLE IF NOT EXISTS` on import (no separate migration tool/files — schema changes go directly into the `sqlite.exec` block, and any table needing removal is dropped via a guarded `sqlite_master` check in the same file, following the existing CF/friend-graph drop pattern). `DB_PATH` is overridable via `MUSIC_SWIPE_DB` env var — this is what lets `test/setup.js` redirect tests to a throwaway file instead of the real database. All `db.js` methods are synchronous.

### Frontend

- `AuthContext` (`frontend/src/auth/`) manages the JWT; `frontend/src/userId.js` generates and persists a per-browser anonymous id in `localStorage` for pre-login swiping, which `api.js` sends as `x-user-id` alongside (or instead of) the bearer token.
- `App.jsx` is a hand-rolled view switcher (`useState('discover'|'history'|'profile'|'settings')`), not a router — except `/share`, which is checked by `window.location.pathname` before the auth gate, since a share-link recipient has no account and must never be routed to the login screen.
- `useSwipe.js` (hook) + `SwipeCard`/`CardStack` implement the gesture UI; `DiscoverView` is the main feed consumer of `GET /tracks/next`.
- `sessionHistory.js` / `useSessionHistory.js`: client-side session log, `sessionStorage`-only by design (the backend independently derives its own session window from `interactions` timestamps for the recommender's momentum — see `getSessionSwipes` in `db.js` — because the client log is deduped and forgeable).
