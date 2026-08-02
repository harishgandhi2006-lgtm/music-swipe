import db from '../db.js';
import { getChart, searchTracks, getAlbum, getArtistTop, getTrackRadio, getRelatedArtists } from './deezer.js';

// ── Config ────────────────────────────────────────────────────────────────────

const COLD_START_THRESHOLD = 5;
const EPSILON = 0.20;
const POOL_TARGET = 12;   // keep this many tracks ready per user
const POOL_MIN    = 4;    // refill when below this
const QUOTA_RETRY_MS = 8000; // wait before retrying after quota error

// Per-process pool cache has no other eviction path — a user who swipes once
// and never returns would otherwise sit in memory for the life of the process.
// At real scale (one pool per active user, not per account) this is the knob
// that keeps memory bounded; LRU because "hasn't swiped in a while" is exactly
// the population it's safe to drop and rebuild on demand.
const MAX_POOLS = 20_000;

// Guarantee an exploration track at least this often. Pure random EPSILON can
// produce long exploit streaks, which is what a genre loop actually feels like.
const EXPLORE_EVERY = 4;

// Genre diversity guard: within the last RECENT_WINDOW queued tracks, no single
// genre may occupy more than MAX_SAME_GENRE slots.
const RECENT_WINDOW = 5;
const MAX_SAME_GENRE = 2;
const MAX_DIVERSITY_SKIPS = 3; // give up rather than stall the pool

// ── Fatigue ───────────────────────────────────────────────────────────────────
// Artist and album ids ride on the raw Deezer candidate, so those caps can be
// enforced during scoring for free. Genre cannot — it needs the /album
// enrichment call — so it keeps a post-fetch backstop as well.
const FATIGUE_WINDOW  = 10; // queued tracks the caps look back over
const MAX_SAME_ARTIST = 2;
const MAX_SAME_ALBUM  = 1;  // tightest: two cuts off one album is the worst offender
const MAX_SAME_FAMILY = 4;  // looser than genre, so narrow taste isn't starved
const FATIGUE_DECAY   = 0.55;

// ── Session momentum ──────────────────────────────────────────────────────────
// A soft tilt toward whatever the user is reacting to right now. Deliberately
// small: the long-term profile stays the anchor, and momentum only reorders
// candidates that were already close. See multGenre for the bound this buys.
//
// That bound (momentum.test.js's "anchoring guarantee", ~0.073) is derived
// from the *default* WEIGHTS.genre/artist. Per-user weight overrides
// (effectiveWeights, below) can raise genre/artist above their defaults,
// which raises this bound proportionally for that user — the guarantee was
// only ever meant to describe the out-of-the-box experience, not a hard cap
// that holds under every possible user override.
const SESSION_GAP_MS   = 1_800_000; // 30 min — the break that ends a sitting
const MOMENTUM_ROWS    = 40;        // how far back the session query looks
const MOMENTUM_TTL_MS  = 2_000;     // memo, so a burst refill re-queries once
const HALF_LIFE_POS    = 3;         // swipes
const HALF_LIFE_MS     = 120_000;   // 2 min
const REJECT_WEIGHT    = -0.6;      // a reject says less than a like does
const W_FLOOR          = 1.5;       // stops one swipe reading as total conviction
const DEADBAND         = 0.15;      // below this, treat as no signal at all
const BETA_GENRE       = 0.18;
const BETA_ARTIST      = 0.10;
const FAMILY_SPILL     = 0.5;       // neighbouring-genre echo, at half strength
const SOFTEN_K0        = 20;        // swipes before momentum starts handing off
const SOFTEN_SCALE     = 40;

// Serve-time re-rank.
//
// HEAD_COMMIT is 0 on purpose. The plan proposed 1, reasoning that the client is
// already displaying the head — but that conflates two different objects. The
// client's two cards were served and removed from this pool already; the pool's
// current head has never been sent anywhere. Committing it would push the first
// momentum-affected card from N+2 out to N+3, losing the very reaction window
// the whole design targets. Kept as a constant in case jitter ever argues back.
const HEAD_COMMIT = 0;
const STALE_W     = 0.05; // gentle FIFO bias, so the queue still drains in order
const STARVE_W    = 0.04; // credit per skip, so nothing is orphaned by a streak

// Back-to-back tracks by one artist stay inside MAX_SAME_ARTIST — the caps
// bound how *often* an artist recurs, not how *close together*. Two in a row is
// the arrangement that actually reads as repetitive, so it gets a nudge rather
// than a ban.
//
// The value is boxed in on both sides, and the window is narrow:
//
//   > STALE_W (0.05)   or it merely cancels the head's FIFO advantage, leaving
//                      an exact tie that the sort resolves straight back to the
//                      repeat — no effect precisely where it matters most.
//   < 0.073            the maximum momentum swing, so an overwhelming streak
//                      can still surface a follow-up immediately.
//
// 0.06 sits between them, and below 2x STARVE_W (0.08) so a couple of skips
// also outweighs it. Discouraged, not forbidden.
const ADJACENT_ARTIST_PENALTY = 0.06;

// Popularity halves because half its former job now lives inside the
// desirability prior — leaving it at 0.20 would count Deezer rank twice, once
// as a relative term and again inside the prior. Duration gives up the most
// because a Gaussian over track length is the weakest signal here. Genre and
// artist concede only 0.04 each: per-user affinity stays the dominant anchor.
//
// Individual-input-only, by policy: every term here is a function of this
// user's own swipes, or of Deezer's own public rank for the track (never any
// other user's profile, and never an aggregate of this app's own users'
// swipes — see .claude/skills/strict-isolation/SKILL.md). No neighbor-
// similarity or friend-group term is permitted in this formula.
const WEIGHTS = {
  genre: 0.26, artist: 0.26, duration: 0.14, popularity: 0.10, desirability: 0.24,
};

// Exposed only so a test can assert, as a standing architectural guard, that
// no collaborative-filtering / social-blending term ever gets re-added here.
export const __test_weights = WEIGHTS;

// ── Per-user weight override ─────────────────────────────────────────────────
// A user's own explicit adjustment of genre/artist emphasis, layered on top of
// WEIGHTS without ever mutating it. Structurally cannot introduce a sixth
// signal: the return shape is always these same five keys, and genre/artist
// are the only two a caller can move — duration/popularity/desirability just
// absorb whatever's left, in the same proportion the defaults use between
// themselves. `prefs` is a plain object (or null); this function does no DB
// access of its own, so it stays independently testable and auditable.
const DEFAULT_REST_BUDGET = WEIGHTS.duration + WEIGHTS.popularity + WEIGHTS.desirability;

export function effectiveWeights(prefs) {
  if (!prefs) return WEIGHTS;

  const clamp01 = v => Math.min(1, Math.max(0, v));
  const genre  = prefs.genre_weight  != null ? clamp01(prefs.genre_weight)  : WEIGHTS.genre;
  const artist = prefs.artist_weight != null ? clamp01(prefs.artist_weight) : WEIGHTS.artist;

  // Both maxed leaves nothing for the rest, on purpose (not an error case) —
  // duration/popularity/desirability go to exactly 0 rather than negative.
  const restBudget = Math.max(0, 1 - genre - artist);
  const scale = restBudget / DEFAULT_REST_BUDGET;

  return {
    genre, artist,
    duration:     WEIGHTS.duration     * scale,
    popularity:   WEIGHTS.popularity   * scale,
    desirability: WEIGHTS.desirability * scale,
  };
}

export function effectiveEpsilon(prefs) {
  return prefs?.exploration_rate ?? EPSILON;
}

// What counts as "a genre/artist this user actually favours", on the symmetric
// Laplace scale in db.affinityScore. 0.5 is that scale's no-evidence point, so
// the genre bar means strictly more likes than rejects; the artist bar sits a
// little higher because artist affinity is the narrower claim. Named here
// because three call sites share them and they must move together with the
// formula — as magic numbers they had already drifted once.
const MIN_GENRE_SCORE  = 0.5;
const MIN_ARTIST_SCORE = 0.55;

// How many qualifying rows to pull before re-ranking by weighted affinity, and
// how many survive into the sampling pool. The wider pull matters: the SQL
// orders by raw score, which is precisely the ordering being corrected — a
// narrow LIMIT would discard established favourites before we could rescue them.
const AFFINITY_CANDIDATES = 25;
const AFFINITY_TOP_N      = 5;

// Grouped so exploration can jump to a *distant* family rather than a
// neighbouring genre. Liking rap shouldn't make "R&B" the adventurous pick.
const GENRE_FAMILIES = {
  urban:      ['Rap/Hip Hop', 'Hip Hop', 'Rap', 'R&B', 'Soul', 'Funk', 'Reggae', 'Dancehall'],
  rock:       ['Rock', 'Hard Rock', 'Metal', 'Punk', 'Alternative', 'Indie', 'Grunge'],
  electronic: ['Electronic', 'Dance', 'House', 'Techno', 'EDM', 'Electro', 'Trance'],
  pop:        ['Pop', 'Dance Pop', 'K-Pop'],
  acoustic:   ['Folk', 'Country', 'Blues', 'Singer & Songwriter', 'Americana'],
  refined:    ['Jazz', 'Classical', 'Opera', 'Soundtrack', 'Gospel'],
  world:      ['Latin', 'World', 'African', 'Asian Music', 'Brazilian', 'Reggaeton', 'Afrobeat'],
};

const EXPLORATION_GENRES = Object.values(GENRE_FAMILIES).flat();

function familyOf(genreName) {
  if (!genreName) return null;
  const lower = genreName.toLowerCase();
  for (const [family, genres] of Object.entries(GENRE_FAMILIES)) {
    if (genres.some(g => {
      const gl = g.toLowerCase();
      return lower.includes(gl) || gl.includes(lower);
    })) return family;
  }
  return null;
}

// ── Per-user pool ─────────────────────────────────────────────────────────────
// Map<userId, {
//   tracks: Track[],          // queued, not yet served (FIFO)
//   ids: Set<number>,
//   refilling: boolean,
//   recent: Context[],        // last FATIGUE_WINDOW queued, for the caps
//   counts: { artist, album, genre, family },  // Maps kept in step with `recent`
//   sinceExplore: number,     // tracks queued since the last exploration pick
// }>
const pools = new Map();

function getPool(userId) {
  if (!pools.has(userId)) {
    const pool = {
      tracks: [],
      ids: new Set(),
      refilling: false,
      recent: [],
      // Counts are maintained incrementally rather than derived on read: the
      // scorer asks about up to 100 candidates per call, and rescanning a
      // 10-element array for each of them is a thousand comparisons on a
      // synchronous thread.
      counts: {
        artist: new Map(), album: new Map(), genre: new Map(), family: new Map(),
      },
      sinceExplore: 0,
      // Serve-side state. Re-ranking means queue order is no longer serve
      // order, so the run the user actually experiences has to be tracked
      // separately from the one the refill loop shapes.
      served: [],
      sinceExploreServed: 0,
      momentumCache: null,
      builtAt: Date.now(),
    };
    pools.set(userId, pool);
    hydrateRecent(userId, pool);
    evictStalePoolsIfNeeded();
  } else {
    // Map preserves insertion order, not access order — re-inserting on every
    // touch is what turns it into an LRU rather than a FIFO of first-ever-seen
    // users (which would evict *active* users first, exactly backwards).
    const pool = pools.get(userId);
    pools.delete(userId);
    pools.set(userId, pool);
  }
  return pools.get(userId);
}

// Drops the least-recently-touched pools once the cache is over budget. Only
// runs on the (rare) path where a brand-new pool is created, so it never adds
// cost to the hot per-swipe request.
function evictStalePoolsIfNeeded() {
  if (pools.size <= MAX_POOLS) return;
  const overflow = pools.size - MAX_POOLS;
  const oldest = [...pools.keys()].slice(0, overflow);
  for (const key of oldest) pools.delete(key);
}

// The pool is per-process, so a restart would otherwise leave the fatigue window
// empty and the first ten tracks unprotected. Replaying the user's last few
// swipes is approximate — it can't see tracks that were queued but never
// swiped — but it beats starting blind, and the relaxation ladder in pickBest
// absorbs any resulting over-tightness.
function hydrateRecent(userId, pool) {
  try {
    const rows = db.getRecentContext(userId, FATIGUE_WINDOW);
    for (const r of rows.reverse()) noteQueued(pool, r); // oldest first
  } catch (err) {
    console.error('Fatigue window hydration failed:', err.message);
  }
}

// All IDs the recommender should not return for the profile it's reading
// (`profileUserId`) into the given buffer (`pool`). `skip` holds tracks
// rejected by the diversity guard during this refill, so we don't fetch the
// same one over and over.
//
// `pool` is always taken as an explicit parameter, never looked up internally
// via getPool(profileUserId) — that keeps this and the functions below
// testable against a throwaway buffer, without ever touching the real
// per-user pool cache.
function getAllExcluded(profileUserId, pool, skip) {
  const interacted = db.getSeenTrackIds(profileUserId);
  return new Set([...interacted, ...pool.ids, ...(skip || [])]);
}

// Deezer often returns no genre for a track. Bucketing those under one label
// rather than exempting them keeps the cap enforceable: an unlabeled run is
// still a run, and letting it through was how a cold pool could emit five
// straight tracks the guard never saw.
const UNLABELED_GENRE = 'Unknown';

function labelOf(track) {
  return track.genre_name || UNLABELED_GENRE;
}

// normalizeTrack writes 0 for a missing artist/album rather than null, so a
// bare ?? would happily key the counts off "artist 0".
const idOf = v => (Number.isFinite(v) && v > 0 ? v : null);

// What gets recorded into the window. Accepts either a normalized Track or a
// getRecentContext row; unlabeled genres bucket together, as before.
function contextOf(track) {
  const genre = labelOf(track);
  return {
    genre,
    family: familyOf(track.genre_name),
    artistId: idOf(track.artist_id),
    albumId: idOf(track.album_id),
  };
}

// What gets *scored*. Raw Deezer candidates nest artist/album, and carry no
// genre at all — that only arrives with the /album enrichment call. Genre is
// therefore passed in from our own cache when we happen to have it, and left
// null otherwise.
//
// Null genre means "unknown", NOT "Unknown": bucketing unknowns together here
// would let two unlabeled tracks in the window cap every uncached candidate at
// once, which is most of them. Unknown-genre candidates simply skip the genre
// and family terms and rely on the post-fetch guard instead.
function candidateOf(raw, cachedGenreName) {
  return {
    genre: cachedGenreName || null,
    family: cachedGenreName ? familyOf(cachedGenreName) : null,
    artistId: idOf(raw.artist?.id),
    albumId: idOf(raw.album?.id),
  };
}

function bump(map, key, delta) {
  if (key == null) return;
  const next = (map.get(key) || 0) + delta;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

// How many of the last RECENT_WINDOW queued tracks share this genre. Kept as a
// slice rather than a count Map because the genre cap deliberately looks back
// over a shorter window than the artist and album caps.
function genreRunLength(pool, genre) {
  if (!genre) return 0;
  return pool.recent.slice(-RECENT_WINDOW).filter(r => r.genre === genre).length;
}

// Would queueing this track make the feed feel repetitive? Unchanged semantics:
// 2 of the last 5, exact genre_name equality, unlabeled bucketed together.
function violatesDiversity(pool, track) {
  return genreRunLength(pool, labelOf(track)) >= MAX_SAME_GENRE;
}

// The same caps, measured over what was actually *served*.
//
// Enforcing them only at queue time is not enough once the pool is re-ranked:
// two tracks by one artist can sit five apart in the queue and still arrive
// back-to-back after reordering. Burnout is a property of the sequence the user
// hears, so it has to be policed here as well. (The simulator caught exactly
// this — queue-order caps held while served-order runs breached them.)
// Weighted so that when everything breaches, the least-bad option wins: hearing
// the same genre again is a far milder annoyance than hearing the same album.
const SERVED_BREACH_COST = { album: 3, artist: 2, genre: 1 };

function servedBreachCost(pool, track) {
  const ctx = contextOf(track);
  const inLast5 = pool.served.slice(-RECENT_WINDOW);
  let cost = 0;

  if (inLast5.filter(r => r.genre === ctx.genre).length >= MAX_SAME_GENRE) {
    cost += SERVED_BREACH_COST.genre;
  }
  if (ctx.artistId &&
      pool.served.filter(r => r.artistId === ctx.artistId).length >= MAX_SAME_ARTIST) {
    cost += SERVED_BREACH_COST.artist;
  }
  if (ctx.albumId &&
      pool.served.filter(r => r.albumId === ctx.albumId).length >= MAX_SAME_ALBUM) {
    cost += SERVED_BREACH_COST.album;
  }
  return cost;
}

function violatesServed(pool, track) {
  return servedBreachCost(pool, track) > 0;
}

function noteServed(pool, track) {
  pool.served.push(contextOf(track));
  if (pool.served.length > FATIGUE_WINDOW) pool.served.shift();
  pool.sinceExploreServed = track.via === 'explore' ? 0 : pool.sinceExploreServed + 1;
}

// Graded burnout penalty plus a hard cap.
//
// Multiplicative rather than subtractive: the base score is already normalized,
// so the penalty stays proportional across strong and weak candidates instead of
// flattening the weak ones to zero and reordering them arbitrarily. It also
// never actually reaches zero, which is what guarantees a strict total order —
// pickBest can always return *something*.
function fatigueOf(pool, cand) {
  const c = pool.counts;
  const nArtist = cand.artistId ? (c.artist.get(cand.artistId) || 0) : 0;
  const nAlbum  = cand.albumId  ? (c.album.get(cand.albumId)   || 0) : 0;
  const nGenre  = genreRunLength(pool, cand.genre);
  const nFamily = cand.family   ? (c.family.get(cand.family)   || 0) : 0;

  return {
    overCap:
      nArtist >= MAX_SAME_ARTIST ||
      nAlbum  >= MAX_SAME_ALBUM  ||
      nGenre  >= MAX_SAME_GENRE  ||
      nFamily >= MAX_SAME_FAMILY,
    // Family counts half: it's the looser, fuzzier signal of the four.
    multiplier: Math.pow(FATIGUE_DECAY, nArtist + nAlbum + nGenre + 0.5 * nFamily),
  };
}

function noteQueued(pool, track) {
  const ctx = contextOf(track);
  pool.recent.push(ctx);
  bump(pool.counts.artist, ctx.artistId, +1);
  bump(pool.counts.album,  ctx.albumId,  +1);
  bump(pool.counts.genre,  ctx.genre,    +1);
  bump(pool.counts.family, ctx.family,   +1);

  while (pool.recent.length > FATIGUE_WINDOW) {
    const old = pool.recent.shift();
    bump(pool.counts.artist, old.artistId, -1);
    bump(pool.counts.album,  old.albumId,  -1);
    bump(pool.counts.genre,  old.genre,    -1);
    bump(pool.counts.family, old.family,   -1);
  }
}

// Exposed for tests only: these are otherwise reachable only behind a live
// Deezer fetch, and unlabeled tracks are hard to provoke on demand.
export const __test_diversity = { violatesDiversity, noteQueued, UNLABELED_GENRE };
export const __test_fatigue = {
  fatigueOf, noteQueued, contextOf, candidateOf, genreRunLength,
  FATIGUE_WINDOW, MAX_SAME_ARTIST, MAX_SAME_ALBUM, MAX_SAME_GENRE,
  MAX_SAME_FAMILY, FATIGUE_DECAY, RECENT_WINDOW,
  newPool: () => ({
    recent: [],
    counts: { artist: new Map(), album: new Map(), genre: new Map(), family: new Map() },
  }),
};

// ── Affinity scoring ──────────────────────────────────────────────────────────

function genreScore(userId, genre_id) {
  if (!genre_id) return 0.5;
  const s = db.getGenreScore(userId, genre_id);
  return s !== null ? s : 0.5;
}
function artistScore(userId, artist_id) {
  if (!artist_id) return 0.5;
  const s = db.getArtistScore(userId, artist_id);
  return s !== null ? s : 0.5;
}
// Takes the preference rather than the userId: resolving it here meant running
// a JOIN aggregate over the user's entire like history once per candidate, up
// to 100 times per call. It's hoisted to the top of pickBest now.
function durationScore(pref, duration) {
  if (!pref) return 0.5;
  // A candidate missing `duration` would otherwise carry NaN through the
  // Gaussian and out into the total.
  if (!Number.isFinite(duration)) return 0.5;
  const z = (duration - pref.mean) / pref.stddev;
  return Math.exp(-0.5 * z * z);
}
// ── Popularity and global desirability ────────────────────────────────────────
//
// Deezer `rank` gets used two different ways, and conflating them is what made
// the old single popularity term useless:
//
//   absolute (popAbs)  — "is this famous?", the prior for desirability below.
//   relative (pctOf)   — "is this the famous one *in this batch*?", the score
//                        term. See popPercentiles.
//
// Both treat a missing or non-finite rank as neutral rather than zero, so a
// track is never penalised for metadata Deezer happened to omit. That guarantee
// is what the old popularityScore was fixed to provide; it lives here now.

const BASE_RATE    = 0.45; // expected global swipe-right rate
const PRIOR_SPREAD = 0.15; // how far rank alone may move that expectation

// Log-compressed because rank is heavily top-skewed: read linearly, the whole
// upper chart bunches against the ceiling and stops discriminating.
function popAbs(rank) {
  if (!Number.isFinite(rank) || rank <= 0) return 0.5;
  return Math.log10(1 + 9 * Math.min(rank, 1_000_000) / 1_000_000);
}

// Probability a swiper likes this track, estimated purely from Deezer's own
// public rank for it. Rank is a noisy proxy for taste, so it's banded
// narrowly (≈[0.30, 0.60]) rather than trusted outright.
//
// Deliberately never blended with this app's own swipe history: an
// aggregate-across-our-users term here would be a crowd/collaborative signal
// by another name, which the isolation policy forbids (see
// .claude/skills/strict-isolation/SKILL.md). Rank is fair game because it
// comes from Deezer's global catalogue metadata, not from any of our users.
function desirabilityScore(rank) {
  return BASE_RATE + PRIOR_SPREAD * (2 * popAbs(rank) - 1);
}

// Kept as an alias so external callers (tests, docs) can still reason about
// "the prior" by that name.
const priorFor = desirabilityScore;

// Recover a missing rank from our own cache before giving up on it.
function rawRank(t, cached) {
  if (Number.isFinite(t.rank)) return t.rank;
  return Number.isFinite(cached?.rank) ? cached.rank : null;
}

// Rank saturates: a 50-track chart is all 900k–1M, so an absolute read scores
// every candidate ≈1.0 and the term discriminates nothing. Ranking *within the
// batch* restores a full spread, and self-normalises across strategies — a
// chart page and an obscure genre search both yield a real gradient rather than
// "all 1.0" and "all 0.05". Free: the candidate array is already in hand.
function popPercentiles(eligible, rankOf) {
  const ranked = eligible
    .filter(t => rankOf(t) !== null)
    .sort((a, b) => rankOf(a) - rankOf(b));

  const n = ranked.length;
  const pct = new Map();

  // Tied ranks share the mean of their positions. Without this, equally-ranked
  // candidates are handed 0.0, 0.5, 1.0 purely by where they landed in the
  // array — a 0.10 score spread conjured out of nothing but arrival order.
  for (let i = 0; i < n; ) {
    const r = rankOf(ranked[i]);
    let j = i;
    while (j + 1 < n && rankOf(ranked[j + 1]) === r) j++;
    const p = n > 1 ? ((i + j) / 2) / (n - 1) : 0.5;
    for (let k = i; k <= j; k++) pct.set(ranked[k].id, p);
    i = j + 1;
  }

  return id => (pct.has(id) ? pct.get(id) : 0.5);
}

export const __test_desirability = {
  popAbs, priorFor, desirabilityScore, popPercentiles, rawRank,
  BASE_RATE, PRIOR_SPREAD,
};

// ── Session momentum ──────────────────────────────────────────────────────────
//
// Derived from interactions.created_at rather than the client's session log:
// that log is sessionStorage-only by design, deduped by track_id (so it drops
// repeat swipes, exactly the signal wanted here), and forgeable besides. This
// also means momentum is available inside background refills, where there is no
// request in flight to carry it.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const EMPTY_MOMENTUM = {
  genre: new Map(), family: new Map(), artist: new Map(),
  beta: { genre: 0, artist: 0 }, sessionLength: 0,
};

function computeMomentum(userId, pool, now = Date.now()) {
  if (pool.momentumCache && now - pool.momentumCache.at < MOMENTUM_TTL_MS) {
    return pool.momentumCache.value;
  }

  let value = EMPTY_MOMENTUM;
  try {
    // Below the cold-start threshold there is no affinity model to modulate —
    // we're still serving chart picks — so momentum stays off entirely.
    if (db.countInteractions(userId) >= COLD_START_THRESHOLD) {
      const rows = db.getSessionSwipes(userId, SESSION_GAP_MS, MOMENTUM_ROWS);
      if (rows.length > 0) value = momentumFrom(rows, now);
    }
  } catch (err) {
    console.error('Momentum computation failed:', err.message);
  }

  pool.momentumCache = { at: now, value };
  return value;
}

// Pure, so the behaviour is testable without a database.
function momentumFrom(rows, now) {
  if (!rows?.length) return EMPTY_MOMENTUM;

  const gRaw = new Map(), fRaw = new Map(), aRaw = new Map();
  let W = 0;

  rows.forEach((r, j) => {
    // Dual decay. Positional decay makes the last few swipes dominate whatever
    // the pace; temporal decay kills momentum when the user pauses mid-session.
    // Multiplied, so momentum requires recent *and* fast — either alone fades.
    const w = Math.pow(0.5, j / HALF_LIFE_POS) *
              Math.pow(0.5, Math.max(0, now - r.created_at) / HALF_LIFE_MS);
    W += w;

    // A like is unambiguous; a reject is overloaded (wrong mood, already knows
    // it, bored thumb), so it steers with less authority than it opposes.
    const c = w * (r.action === 'like' ? 1 : REJECT_WEIGHT);

    if (r.genre_id != null) gRaw.set(r.genre_id, (gRaw.get(r.genre_id) || 0) + c);
    const fam = familyOf(r.genre_name);
    if (fam) fRaw.set(fam, (fRaw.get(fam) || 0) + c);
    const aid = idOf(r.artist_id);
    if (aid) aRaw.set(aid, (aRaw.get(aid) || 0) + c);
  });

  // Dividing by the total weight is what makes momentum self-dilute: a genre
  // that is 2 of 2 swipes reads strongly, the same genre at 2 of 12 reads
  // weakly. The floor stops a single swipe reading as total conviction.
  const Z = Math.max(W, W_FLOOR);
  const norm = (raw) => {
    const m = new Map();
    for (const [k, v] of raw) m.set(k, clamp(v / Z, -1, 1));
    return m;
  };

  // Past SOFTEN_K0 swipes the persisted profile has enough new evidence of its
  // own, so momentum steps back and lets it lead.
  const K = rows.length;
  const soften = (B) => B * SOFTEN_SCALE / (SOFTEN_SCALE + Math.max(0, K - SOFTEN_K0));

  return {
    genre: norm(gRaw), family: norm(fRaw), artist: norm(aRaw),
    beta: { genre: soften(BETA_GENRE), artist: soften(BETA_ARTIST) },
    sessionLength: K,
  };
}

// Alternating like/reject on one genre largely cancels; the deadband stops what
// little remains from producing visible thrash.
const deadband = (m) => (Math.abs(m) < DEADBAND ? 0 : m);

// Bounded to [1-BETA, 1+BETA]. Since these multiply only the genre and artist
// terms (0.52 of the score), the largest possible swing is
// 0.26*0.18 + 0.26*0.10 = 0.073 — so two tracks more than 0.146 apart on base
// score can never trade places, whatever the streak. That is the guarantee that
// keeps the long-term profile in charge.
function multGenre(mom, track) {
  if (!mom.beta.genre) return 1;
  let m = mom.genre.get(track.genre_id);
  if (m === undefined) {
    // No direct read on this genre — fall back to a half-strength echo from its
    // family, so liking "Hip Hop" also lifts "Rap/Hip Hop".
    const fam = familyOf(track.genre_name);
    m = fam ? FAMILY_SPILL * (mom.family.get(fam) ?? 0) : 0;
  }
  return 1 + mom.beta.genre * deadband(m);
}

function multArtist(mom, track) {
  if (!mom.beta.artist) return 1;
  return 1 + mom.beta.artist * deadband(mom.artist.get(track.artist_id) ?? 0);
}

export const __test_momentum = {
  momentumFrom, multGenre, multArtist, deadband, EMPTY_MOMENTUM,
  // Bound late: these are defined further down the module.
  reRankAndServe: (...a) => reRankAndServe(...a),
  violatesServed: (...a) => violatesServed(...a),
  servedBreachCost: (...a) => servedBreachCost(...a),
  ADJACENT_ARTIST_PENALTY, STALE_W, STARVE_W,
  makePool: (tracks) => ({
    tracks, ids: new Set(tracks.map(t => t.id)),
    recent: [], served: [], sinceExplore: 0, sinceExploreServed: 0,
    counts: { artist: new Map(), album: new Map(), genre: new Map(), family: new Map() },
    momentumCache: null, builtAt: Date.now(), refilling: false,
  }),
  SESSION_GAP_MS, HALF_LIFE_POS, HALF_LIFE_MS, REJECT_WEIGHT, W_FLOOR,
  DEADBAND, BETA_GENRE, BETA_ARTIST, FAMILY_SPILL, SOFTEN_K0, SOFTEN_SCALE,
};

// ── Weighted affinity: rate tempered by evidence ──────────────────────────────
//
// The smoothed affinity score measures how often something is liked, not how
// much is known about it. On its own that lets a genre swiped right once (0.667)
// outrank one liked 28 times out of 45 (0.617) — and since the strategies then
// keep only the strongest few, the established favourite can be dropped outright
// by a single-swipe anomaly.
//
// log1p is sublinear volume weighting: a long history should count for more
// without dominating. 28 likes is worth roughly 4.9x one like here, not 28x —
// enough to restore the sensible ordering, not so much that volume alone
// decides everything.
function affinityWeight(row) {
  return row.score * Math.log1p(row.likes);
}

// Rank by weighted affinity, keep the strongest few, then sample proportionally
// so the leader is favoured without the rest being shut out.
function sampleByAffinity(rows, limit = AFFINITY_TOP_N) {
  const ranked = rows
    .map(row => ({ row, w: affinityWeight(row) }))
    .filter(x => x.w > 0)          // likes > 0 is enforced upstream, but be safe
    .sort((a, b) => b.w - a.w)
    .slice(0, limit);

  if (ranked.length === 0) return null;

  const total = ranked.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const x of ranked) {
    r -= x.w;
    if (r <= 0) return x.row;
  }
  return ranked[ranked.length - 1].row; // float drift guard
}

export const __test_affinity = {
  affinityWeight, sampleByAffinity, AFFINITY_CANDIDATES, AFFINITY_TOP_N,
  MIN_GENRE_SCORE, MIN_ARTIST_SCORE,
};

// ── Genre enrichment (1 API call, cached) ─────────────────────────────────────

async function enrichWithGenre(track) {
  const cached = db.getTrack(track.id);
  if (cached?.genre_id != null) return { ...track, genre_id: cached.genre_id, genre_name: cached.genre_name };
  try {
    const album = await getAlbum(track.album.id);
    const genre_id   = album.genre_id   || album.genres?.data?.[0]?.id   || null;
    const genre_name = album.genres?.data?.[0]?.name || null;
    return { ...track, genre_id, genre_name };
  } catch {
    return { ...track, genre_id: null, genre_name: null };
  }
}

function normalizeTrack(raw, genre_id, genre_name) {
  return {
    id:          raw.id,
    title:       raw.title,
    artist_name: raw.artist?.name  || '',
    artist_id:   raw.artist?.id    || 0,
    album_title: raw.album?.title  || '',
    album_id:    raw.album?.id     || 0,
    cover_url:   raw.album?.cover_medium || raw.album?.cover || '',
    preview_url: raw.preview || '',
    genre_id, genre_name,
    duration:    raw.duration || 30,
    rank:        raw.rank     || 0,
    fetched_at:  Date.now(),
  };
}

// ── Pick best from candidates (scores WITHOUT enriching all of them) ───────────

// `pool` is the buffer whose fatigue/diversity state this call both reads and
// updates — explicit, rather than resolved internally via getPool(userId), so
// tests can point pickBest at a throwaway buffer without touching the real
// per-user pool cache.
async function pickBest(userId, candidates, excluded, pool, opts = {}) {
  const { mode = 'affinity', topN = 20 } = opts;

  const all = candidates.filter(t => t.preview && !excluded.has(t.id));
  if (all.length === 0) return null;

  // Resolved once for the whole batch rather than per candidate. The cache
  // lookup was already happening per candidate; the duration preference was
  // not, and it costs far more than a point read.
  const cached = new Map(all.map(t => [t.id, db.getTrack(t.id)]));

  // Burnout caps are applied here, before the top-N slice and before the winner
  // gets enriched — so a capped artist costs nothing, where the post-fetch guard
  // would already have spent a search call and an /album call to reject it.
  const fatigue = new Map(
    all.map(t => [t.id, fatigueOf(pool, candidateOf(t, cached.get(t.id)?.genre_name))])
  );

  // Relaxation ladder: if the caps would leave nothing at all, drop the hard
  // caps but keep the graded penalty. A fatigued track beats an empty deck, and
  // the multiplier still floats the least-fatigued option to the top.
  const uncapped = all.filter(t => !fatigue.get(t.id).overCap);
  const eligible = uncapped.length > 0 ? uncapped : all;

  const rankOf  = t => rawRank(t, cached.get(t.id));
  const pctOf   = popPercentiles(eligible, rankOf);
  const durPref = db.getDurationPreference(userId);
  const weights = effectiveWeights(db.getUserPreferences(userId));

  const scored = eligible.map(t => {
    let s;
    if (mode === 'explore') {
      // Deliberately taste-blind. Ranking exploration candidates by existing
      // affinity is what collapsed discovery back into the user's current
      // genre — the whole point here is to escape that gravity. Absolute
      // popularity is kept at a low weight only so picks stay recognisable
      // rather than obscure, and randomness dominates.
      s = 0.25 * popAbs(rankOf(t)) + 0.75 * Math.random();
    } else {
      s = (
        weights.genre        * genreScore(userId, cached.get(t.id)?.genre_id ?? null) +
        weights.artist       * artistScore(userId, t.artist?.id) +
        weights.duration     * durationScore(durPref, t.duration) +
        weights.popularity   * pctOf(t.id) +
        weights.desirability * desirabilityScore(rankOf(t))
      );
    }
    // Applied in both modes: exploration has no licence to spam one artist
    // either. Never zero, so the ordering below stays strict.
    s *= fatigue.get(t.id).multiplier;

    // Belt and braces: the comparator below must be a total order. Every term
    // is guarded individually, but one non-finite score would silently corrupt
    // the sort rather than fail loudly, so refuse to let one through at all.
    return { t, s: Number.isFinite(s) ? s : 0 };
  }).sort((a, b) => b.s - a.s);

  // Explore draws from a wider slice so we're not just re-picking the same
  // handful of "safe" tracks out of an unfamiliar genre.
  const width = mode === 'explore' ? Math.max(topN, 30) : topN;
  // Named to distinguish it from the user's prefetch pool above — this is just
  // the top slice of this batch, sampled from uniformly.
  const topSlice = scored.slice(0, Math.min(width, scored.length));
  const chosen = topSlice[Math.floor(Math.random() * topSlice.length)].t;

  // Enrich only the winner (1 API call)
  const enriched  = await enrichWithGenre(chosen);
  const track     = normalizeTrack(enriched, enriched.genre_id, enriched.genre_name);
  db.upsertTrack(track);
  return track;
}

// ── Fetch strategies ──────────────────────────────────────────────────────────
// Every strategy takes the target buffer (`pool`) explicitly, for the same
// reason pickBest does.

async function strategyChart(userId, excluded, pool) {
  return pickBest(userId, await getChart(50), excluded, pool);
}

async function strategyTrackRadio(userId, excluded, pool) {
  const likedIds = db.getRecentlyLikedTrackIds(userId, 10);
  if (likedIds.length === 0) return null;
  for (const trackId of likedIds) {
    const radio = await getTrackRadio(trackId, 25).catch(() => []);
    const track = await pickBest(userId, radio, excluded, pool);
    if (track) return track;
  }
  return null;
}

async function strategyArtist(userId, excluded, pool) {
  // This strategy deliberately targets an artist the user already likes, so it
  // will fight the artist cap head-on. Drop capped artists from the draw rather
  // than spending a search call on results that would all be filtered out.
  // Returning null here is a normal fall-through — fetchOneTrack just moves on
  // to the next strategy.
  const counts = pool.counts.artist;
  const candidates = db.getTopArtists(userId, MIN_ARTIST_SCORE, AFFINITY_CANDIDATES)
    .filter(a => (counts.get(a.artist_id) || 0) < MAX_SAME_ARTIST);
  if (candidates.length === 0) return null;

  const chosen = sampleByAffinity(candidates);
  if (!chosen) return null;

  let artistId = chosen.artist_id;
  if (Math.random() > 0.5) {
    const related = (await getRelatedArtists(artistId, 10).catch(() => []))
      .filter(a => (counts.get(a.id) || 0) < MAX_SAME_ARTIST);
    if (related.length > 0) artistId = related[Math.floor(Math.random() * related.length)].id;
  }
  return pickBest(userId, await getArtistTop(artistId, 50).catch(() => []), excluded, pool);
}

async function strategyGenre(userId, excluded, pool) {
  const candidates = db.getTopGenres(userId, MIN_GENRE_SCORE, AFFINITY_CANDIDATES);
  if (candidates.length === 0) return null;

  const chosen = sampleByAffinity(candidates);
  if (!chosen) return null;

  const offset = Math.floor(Math.random() * 80);
  return pickBest(userId, await searchTracks(chosen.genre_name, 100, offset), excluded, pool);
}

/**
 * Choose a genre by *distance* from what the user already listens to.
 * Ranking whole families by engagement (rather than picking any untouched
 * genre) is what stops "you liked rap, here's some R&B" from counting as
 * discovery.
 */
function pickExplorationGenre(userId) {
  const scores = db.getGenreScores(userId);

  // Total swipes per family — engagement, not approval. A family the user
  // rejected is still a family they've been shown plenty of.
  const engagement = new Map();
  for (const g of scores) {
    const fam = familyOf(g.genre_name);
    if (fam) engagement.set(fam, (engagement.get(fam) || 0) + g.likes + g.rejects);
  }

  // Inverse-engagement weighted sample across *all* families. Taking the "N
  // least engaged" instead collapses to the same handful whenever engagement
  // ties at zero — with a single-genre profile that silently put four of the
  // seven families permanently out of reach.
  const families = Object.keys(GENRE_FAMILIES);
  const weights = families.map(f => 1 / (1 + (engagement.get(f) || 0)));
  const total = weights.reduce((a, b) => a + b, 0);

  let r = Math.random() * total;
  let family = families[families.length - 1];
  for (let i = 0; i < families.length; i++) {
    r -= weights[i];
    if (r <= 0) { family = families[i]; break; }
  }

  const touched = db.getTouchedGenreNames(userId);
  const fresh = GENRE_FAMILIES[family].filter(g => !touched.has(g));
  const list = fresh.length > 0 ? fresh : GENRE_FAMILIES[family];

  return list[Math.floor(Math.random() * list.length)];
}

async function strategyExplore(userId, excluded, pool) {
  // Try a couple of distant genres before giving up — a single failed search
  // used to fall straight through to the exploit strategies, which is how the
  // real exploration rate ended up well under EPSILON.
  for (let attempt = 0; attempt < 2; attempt++) {
    const genreName = pickExplorationGenre(userId);
    const offset = Math.floor(Math.random() * 50);
    const results = await searchTracks(genreName, 50, offset).catch(() => []);
    const track = await pickBest(userId, results, excluded, pool, { mode: 'explore' });
    if (track) return track;
  }
  return null;
}

// ── Serve-time re-rank ────────────────────────────────────────────────────────
//
// The pool stops being a queue and becomes a candidate buffer. Re-scoring what
// is already in memory costs nothing — no Deezer calls, no added latency — and
// is strictly better informed than the scoring that put the tracks there:
// pooled tracks are normalized, so genre_id is always populated, where pickBest
// only sees a genre when the track happened to be cached already.

function tag(track, via) {
  if (track) track.via = via;
  return track;
}

function reRankAndServe(userId, pool) {
  const mom     = computeMomentum(userId, pool);
  const durPref = db.getDurationPreference(userId);
  const weights = effectiveWeights(db.getUserPreferences(userId));

  // Percentile within the pool, for the same reason pickBest uses one: absolute
  // rank saturates and stops discriminating. Shared helper, so tie handling
  // stays identical on both paths.
  const pctOf = popPercentiles(pool.tracks, t => (Number.isFinite(t.rank) ? t.rank : null));

  // Whoever was served last. Only the immediate neighbour matters here — wider
  // recurrence is already the caps' job.
  const lastArtistId = idOf(pool.served[pool.served.length - 1]?.artistId);

  const len = pool.tracks.length;
  const scored = pool.tracks.map((t, i) => {
    const base =
      weights.genre        * genreScore(userId, t.genre_id) +
      weights.artist       * artistScore(userId, t.artist_id) +
      weights.duration     * durationScore(durPref, t.duration) +
      weights.popularity   * pctOf(t.id) +
      weights.desirability * desirabilityScore(t.rank);

    // Exploration is momentum-immune. Left exposed, a hot streak would sink
    // every discovery pick to the bottom of the tail and the realized explore
    // rate would quietly fall below EPSILON — the exact failure EXPLORE_EVERY
    // was added to prevent. Neutral, not boosted: discovery competes on merit.
    const mult = t.via === 'explore' ? 1 : multGenre(mom, t) * multArtist(mom, t);

    // Applied after the multiplier, and flat rather than proportional: this is
    // a fixed argument against adjacency, not a judgement about the track. A
    // strong enough base score or momentum tilt still outweighs it.
    const adjacent = lastArtistId !== null && idOf(t.artist_id) === lastArtistId;

    const s = base * mult
      + STALE_W  * (len > 1 ? 1 - i / (len - 1) : 0)
      + STARVE_W * (t.passedOver || 0)
      - (adjacent ? ADJACENT_ARTIST_PENALTY : 0);

    return { t, s: Number.isFinite(s) ? s : 0 };
  }).sort((a, b) => b.s - a.s);

  // Discovery on a schedule, regardless of score. This is the hard floor that
  // momentum cannot argue with.
  //
  // It still prefers a discovery pick that respects the served window: taking
  // the first explore track unconditionally was quietly punching a hole in the
  // caps roughly one serve in five, which is how same-genre runs of three kept
  // appearing even with a clean alternative sitting in the pool.
  //
  // When no discovery pick is entirely clean, take the least-damaging one
  // rather than the first: the breach costs are weighted so this yields a
  // repeated genre before it yields a repeated artist, and an artist before an
  // album. Discovery outranks the genre cap; it does not outrank album burnout.
  let winner = null;
  if (pool.sinceExploreServed >= EXPLORE_EVERY) {
    const explores = scored.filter(x => x.t.via === 'explore');
    if (explores.length > 0) {
      winner = explores
        .map(x => ({ t: x.t, s: x.s, cost: servedBreachCost(pool, x.t) }))
        .sort((a, b) => a.cost - b.cost || b.s - a.s)[0].t;
    }
  }
  // Then the best candidate that doesn't extend a run the user just heard.
  if (!winner) winner = scored.find(x => !violatesServed(pool, x.t))?.t ?? null;

  // Every candidate breaches something — a small pool of one artist, say. Serve
  // the least-bad rather than the highest-scoring: taking scored[0] here would
  // happily repeat the album just played if it happened to rank top.
  if (!winner) {
    winner = scored
      .map(x => ({ t: x.t, s: x.s, cost: servedBreachCost(pool, x.t) }))
      .sort((a, b) => a.cost - b.cost || b.s - a.s)[0].t;
  }

  // Losers accrue starvation credit, so a long streak can't orphan a pooled
  // track indefinitely — after a few skips it wins on credit alone.
  for (const x of scored) if (x.t !== winner) x.t.passedOver = (x.t.passedOver || 0) + 1;

  const idx = pool.tracks.indexOf(winner);
  if (idx >= 0) pool.tracks.splice(idx, 1);
  pool.ids.delete(winner.id);
  noteServed(pool, winner);
  return winner;
}

// ── Single track fetch (picks one strategy) ───────────────────────────────────
//
// `userId` here means exactly one thing throughout this whole module: whose
// rows to read for scoring (genre/artist affinity, duration preference,
// session momentum, seen-track exclusion). `pool` is a separate concern —
// which buffer's fatigue/diversity/serve-order state to consult and update.
// The two are kept as separate parameters (rather than pool being resolved
// internally from userId) purely for testability against a throwaway buffer.

async function fetchOneTrack(userId, pool, skip) {
  const excluded = getAllExcluded(userId, pool, skip);
  const total    = db.countInteractions(userId);

  if (total < COLD_START_THRESHOLD) {
    return tag(await strategyChart(userId, excluded, pool), 'exploit');
  }

  // Explore on the usual EPSILON roll (or the user's own override), but also
  // force one whenever we've gone EXPLORE_EVERY tracks without it. The forced
  // path is what breaks a streak; random alone can go a long time without
  // firing.
  const overdue = pool.sinceExplore >= EXPLORE_EVERY;
  if (overdue || Math.random() < effectiveEpsilon(db.getUserPreferences(userId))) {
    const t = await strategyExplore(userId, excluded, pool).catch(e => { if (e.isQuota) throw e; return null; });
    if (t) {
      pool.sinceExplore = 0;
      return tag(t, 'explore');
    }
  }

  const likedCount  = db.getRecentlyLikedTrackIds(userId, 1).length;
  const artistCount = db.getTopArtists(userId, MIN_ARTIST_SCORE, 1).length;
  const roll = Math.random();

  const ordered = [];
  if (likedCount > 0 && roll < 0.40)       ordered.push(strategyTrackRadio, strategyArtist, strategyGenre, strategyExplore, strategyChart);
  else if (artistCount > 0 && roll < 0.65) ordered.push(strategyArtist, strategyTrackRadio, strategyGenre, strategyExplore, strategyChart);
  else                                      ordered.push(strategyGenre, strategyTrackRadio, strategyArtist, strategyExplore, strategyChart);

  for (const strategy of ordered) {
    try {
      const t = await strategy(userId, excluded, pool);
      if (t) {
        // Only exploit strategies advance the counter; strategyExplore appearing
        // as a fallback here still counts as exploration.
        if (strategy === strategyExplore) pool.sinceExplore = 0;
        else pool.sinceExplore++;
        return tag(t, strategy === strategyExplore ? 'explore' : 'exploit');
      }
    } catch (err) {
      if (err.isQuota) throw err; // stop immediately on quota
    }
  }
  return null;
}

// ── Pool management ───────────────────────────────────────────────────────────

async function refillPool(userId, pool) {
  if (pool.refilling) return;
  pool.refilling = true;

  const skip = new Set(); // diversity-rejected tracks, this refill only
  let skips = 0;

  while (pool.tracks.length < POOL_TARGET) {
    try {
      const track = await fetchOneTrack(userId, pool, skip);
      if (!track) break; // no more unique tracks available right now

      if (pool.ids.has(track.id)) continue;

      // Too much of this genre lately — put it aside and ask for something
      // else. Bounded, so a narrow catalogue can't stall the refill.
      if (violatesDiversity(pool, track) && skips < MAX_DIVERSITY_SKIPS) {
        skip.add(track.id);
        skips++;
        continue;
      }
      skips = 0;

      pool.tracks.push(track);
      pool.ids.add(track.id);
      pool.builtAt = Date.now(); // freshness is measured from the last addition
      noteQueued(pool, track);
    } catch (err) {
      if (err.isQuota) {
        console.log(`Quota hit for user ${userId} — pausing pool refill for ${QUOTA_RETRY_MS}ms`);
        await new Promise(r => setTimeout(r, QUOTA_RETRY_MS));
        // Continue loop — don't break, just slow down
      } else {
        console.error('Pool refill error:', err.message);
        break;
      }
    }
  }

  pool.refilling = false;
}

// Given a profile to read and a buffer to serve from, top the buffer up if
// it's running low, then hand back one track — from the pre-fetched,
// momentum-re-ranked buffer if it has anything, or fetched synchronously
// (still through the same diversity guard) if it's empty.
async function serveFromPool(profileUserId, pool) {
  if (pool.tracks.length < POOL_MIN && !pool.refilling) {
    refillPool(profileUserId, pool); // intentionally not awaited
  }

  if (pool.tracks.length > 0) {
    return reRankAndServe(profileUserId, pool);
  }

  const skip = new Set();
  for (let attempt = 0; attempt <= MAX_DIVERSITY_SKIPS; attempt++) {
    const track = await fetchOneTrack(profileUserId, pool, skip);
    if (!track) return null;
    if (attempt < MAX_DIVERSITY_SKIPS && violatesDiversity(pool, track)) {
      skip.add(track.id);
      continue;
    }
    // Served straight through without ever entering the pool, so both windows
    // have to be told about it here.
    noteQueued(pool, track);
    noteServed(pool, track);
    return track;
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getNextTrack(userId = 'default') {
  const pool = getPool(userId);

  // A pool assembled in a previous sitting is stale — it was built under
  // momentum and a taste picture that no longer apply. Drop it so the first
  // card of a new session is an honest one.
  if (Date.now() - pool.builtAt > SESSION_GAP_MS && pool.tracks.length > 0) {
    console.log(`Pool for user ${userId} is from a previous session — flushing`);
    pool.tracks = [];
    pool.ids.clear();
    pool.served = [];
    pool.sinceExploreServed = 0;
    pool.momentumCache = null;
  }

  return serveFromPool(userId, pool);
}

// Warm up the pool for a user in the background (call at startup or first visit)
export function warmPool(userId = 'default') {
  const pool = getPool(userId);
  if (pool.tracks.length < POOL_MIN && !pool.refilling) {
    refillPool(userId, pool);
  }
}

export function updateAffinityScores(userId, track_id) {
  // This swipe is the momentum signal — drop the memo so the next serve sees
  // it. Read directly rather than via getPool, which would build (and hydrate)
  // a pool for a user who doesn't have one yet.
  const pool = pools.get(userId);
  if (pool) pool.momentumCache = null;

  const track = db.getTrack(track_id);
  if (!track) return;
  if (track.genre_id) {
    const { likes, rejects } = db.getGenreInteractionCounts(userId, track.genre_id);
    db.upsertGenreScore(userId, track.genre_id, track.genre_name, likes, rejects);
  }
  if (track.artist_id) {
    const { likes, rejects } = db.getArtistInteractionCounts(userId, track.artist_id);
    db.upsertArtistScore(userId, track.artist_id, track.artist_name, likes, rejects);
  }
}
