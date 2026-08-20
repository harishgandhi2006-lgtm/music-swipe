# Architecture: Scaling to 1,000+ Concurrent Users

This document covers the database/concurrency strategy for production
deployment. It does not cover the recommendation engine's scoring logic
(see `.claude/skills/strict-isolation/SKILL.md` for that) or the social
feature layer's data model (see `backend/services/social.js` once it lands)
— both are architecturally separate concerns from what's below, though the
SSE transport for social events is covered here since it's a concurrency
concern.

## The real bottleneck: `DatabaseSync` is synchronous

`backend/db.js` uses `node:sqlite`'s `DatabaseSync` (`new
DatabaseSync(DB_PATH)`, `db.js:11`), a single module-level connection reused
by every request via closure. Every method on it — `.get()`, `.all()`,
`.run()` — executes **synchronously**, blocking Node's one event-loop thread
for the full duration of the call.

This is a more fundamental limit than SQLite's own locking model. WAL mode
(already enabled, `db.js:13`) already lets readers proceed without blocking
on a concurrent writer — SQLite's locking isn't the ceiling here. The ceiling
is that Node is single-threaded, so *any* synchronous call — even a fast,
indexed point-read — fully stalls every other in-flight request while it
runs.

The consequence shows up as fan-out, not raw latency. Before the Phase 1 fix,
`pickBest` (`backend/services/recommender.js`) issued one `db.getTrack` call
per candidate track and one `db.getGenreScore`/`db.getArtistScore` call per
eligible candidate — up to ~100 synchronous DB round-trips for a single
`GET /api/tracks/next` request. Under concurrent load, that one request
doesn't just take 100x longer for the user who made it; it blocks every
other user's request behind it on the event loop for that entire span. At
1,000 concurrent users, fan-out like this is what falls over first, well
before SQLite's own write-lock contention becomes visible.

The fix has three layers, applied in order of leverage:

1. **Reduce the number of synchronous calls per request** — batch N+1 reads
   into single queries (`WHERE id IN (...)`, bulk per-user score fetches).
   This is the highest-leverage fix and must land first: caching a query
   that still runs 100 times per request just turns 100 slow calls into 100
   fast ones — it doesn't remove the round-trip count that blocks the event
   loop.
2. **Cache in-process where possible** — an L1 LRU cache for data that's
   effectively immutable per-request (track metadata) avoids even a Redis
   network round-trip, not just a SQLite disk hit.
3. **Move remaining hot reads off the SQLite thread** — an L2 Redis
   read-through cache for data that changes per-user over time (affinity
   scores), where an in-process cache would go stale across the fleet.

## Pragma tuning (`backend/db.js:13-14`)

Applied alongside the existing `journal_mode = WAL` / `foreign_keys = ON`:

| Pragma | Value | Why |
|---|---|---|
| `busy_timeout` | `5000` | Currently absent. Under concurrent writers (interaction inserts, score upserts), a writer can hit `SQLITE_BUSY` immediately and surface as a hard error instead of waiting briefly for the lock to clear. |
| `synchronous` | `NORMAL` | Safe to relax from WAL's default `FULL` — WAL already protects against corruption on crash. Trades a small durability window for materially fewer fsyncs per write. |
| `cache_size` | `-20000` (~20MB) | SQLite's default page cache is small; at 1,000+ users' worth of interaction/track history, more of the working set stays resident. |
| `mmap_size` | `268435456` (256MB) | Lets read-heavy paths (`getTrack`, history, liked archive) go through memory-mapped I/O instead of the page cache path. |
| `wal_autocheckpoint` | `1000` | Bounds WAL file growth under sustained write volume (likes/rejects/score upserts at 1,000-user scale) by forcing a checkpoint back into the main DB file every 1,000 pages, instead of relying on SQLite's default and letting the WAL grow unbounded between checkpoints. |

### Query batch chunking

`db.getTracksByIds(ids)` (new, backing the `pickBest` N+1 fix) must chunk
its input into batches of ≤100 ids per `WHERE id IN (...)` query. SQLite has
a compile-time bound on the number of host parameters per statement (default
999, but not guaranteed across builds/versions) — a single unbounded `IN`
clause over a large candidate set risks hitting that limit outright rather
than degrading gracefully. Candidate batches in this codebase (`pickBest`'s
`topN`/explore-width) are well under 100 today, but chunking makes the
function correct regardless of future candidate-pool size instead of
implicitly depending on today's constants staying small.

## Two-tier caching: in-process LRU (L1) + Redis (L2)

Not all hot reads have the same staleness tolerance, so `backend/services/cache.js`
implements two tiers rather than one:

- **L1 — in-process LRU (`lru-cache`, max 5,000 entries, 1hr TTL):** track
  metadata (`db.getTracksByIds` results). Track rows only change on
  `db.upsertTrack`, which happens rarely (once per newly-served track) and
  is process-local anyway (each server process independently upserts what
  it serves) — a slightly stale in-process copy costs nothing in
  correctness and eliminates both the SQLite disk hit and a Redis network
  round-trip for ~95%+ of candidate reads, since the same popular tracks
  recur across many users' pools.
- **L2 — Redis:** per-user affinity data (`getGenreScores(userId)`,
  `getArtistScores(userId)`), short TTL (~30-60s), explicitly invalidated in
  `updateAffinityScores` right after the `db.upsertGenreScore`/
  `db.upsertArtistScore` calls. This data changes per-user over the session
  and must stay consistent across whichever server process handles that
  user's next request — an in-process cache would go stale across the
  fleet, so this tier needs to be shared.

`cache.js` no-ops the L2 tier (pass-through to SQLite) when `REDIS_URL` is
unset, so local dev and the test suite (which redirects `MUSIC_SWIPE_DB` to
a throwaway file via `test/setup.js`) don't gain a hard Redis dependency.
The L1 tier has no such dependency — it's just an in-process Map-backed LRU,
always on.

## SSE transport for social events (Phase 2, ~1,000 concurrent connections)

Real-time friend-request/activity updates use one long-lived SSE connection
per active user (`GET /api/social/stream`), not polling — polling SQLite per
open connection at this scale reintroduces the exact synchronous-fan-out
problem described above. Two concurrency-specific requirements on top of the
push-driven `EventEmitter` design:

- **Scoped routing, not broadcast.** The event bus must route directly to
  the owning connection — `socialBus.on(\`user:${userId}\`, handler)` — never
  emit a global event that every one of ~1,000 open SSE handlers has to
  filter. A global broadcast turns every activity event into O(connections)
  work instead of O(1); at 1,000 connections that's a real per-event cost
  for something that should be a single targeted dispatch.
- **Keepalive against intermediary timeouts.** `req.socket.setTimeout(0)`
  (disable Node's default socket timeout for this long-lived connection) and
  a periodic heartbeat comment (`: ping\n\n`) every 15s. Without this,
  reverse proxies (Nginx, Cloudflare) sitting in front of the app will treat
  a quiet-but-healthy SSE connection as dead and drop it, since SSE has no
  transport-level keepalive of its own — the comment line is invisible to
  `EventSource`'s message handler but resets the proxy's idle timer.

## Postgres migration: considered and deferred

Explicitly not pursued right now. Reasoning:

- No evidence yet that **write** throughput is the actual limiter — the
  N+1 analysis above shows the current bottleneck is synchronous **read**
  fan-out per request, which batching + the two-tier cache directly address.
- This repo has no migration framework today — schema changes are inline
  `CREATE TABLE IF NOT EXISTS` statements in `db.js`, with guarded
  `DROP TABLE` blocks for removed tables. A DB swap means building that
  tooling from scratch as part of the migration, not just changing a driver.
- A client-server DB buys real connection pooling and multi-process writes,
  which matters once a single Node process becomes the throughput limit
  (not just the DB). That's a real future need, but not a proven one yet.

Revisit only if post-launch metrics show write contention or SQLite
single-file constraints becoming the actual limiting factor — not
preemptively.

## Social feature isolation

`backend/services/social.js` and `backend/routes/social.js` (Phase 2) are
architecturally separate from the recommendation path covered above: new
tables (`social_connection_requests`, `social_connections`,
`social_activity_events`) that never feed `backend/services/recommender.js`'s
scoring, and a service layer with zero import relationship to it in either
direction. See `.claude/skills/audit-isolation/SKILL.md` for the
verification checklist this must continue to pass.
