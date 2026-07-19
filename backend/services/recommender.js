import db from '../db.js';
import { getChart, searchTracks, getAlbum, getArtistTop, getTrackRadio, getRelatedArtists } from './deezer.js';

// ── Config ────────────────────────────────────────────────────────────────────

const COLD_START_THRESHOLD = 5;
const EPSILON = 0.20;
const POOL_TARGET = 12;   // keep this many tracks ready per user
const POOL_MIN    = 4;    // refill when below this
const QUOTA_RETRY_MS = 8000; // wait before retrying after quota error

// Guarantee an exploration track at least this often. Pure random EPSILON can
// produce long exploit streaks, which is what a genre loop actually feels like.
const EXPLORE_EVERY = 4;

// Genre diversity guard: within the last RECENT_WINDOW queued tracks, no single
// genre may occupy more than MAX_SAME_GENRE slots.
const RECENT_WINDOW = 5;
const MAX_SAME_GENRE = 2;
const MAX_DIVERSITY_SKIPS = 3; // give up rather than stall the pool

const WEIGHTS = { genre: 0.30, artist: 0.30, duration: 0.20, popularity: 0.20 };

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
// Map<userId, { tracks: Track[], ids: Set<number>, refilling: boolean }>
const pools = new Map();

function getPool(userId) {
  if (!pools.has(userId)) {
    pools.set(userId, {
      tracks: [],
      ids: new Set(),
      refilling: false,
      recentGenres: [],   // genres of the last RECENT_WINDOW queued tracks
      sinceExplore: 0,    // tracks queued since the last exploration pick
    });
  }
  return pools.get(userId);
}

// All IDs the recommender should not return for this user.
// `skip` holds tracks rejected by the diversity guard during this refill, so we
// don't fetch the same one over and over.
function getAllExcluded(userId, skip) {
  const interacted = db.getSeenTrackIds(userId);
  const pooled     = getPool(userId).ids;
  return new Set([...interacted, ...pooled, ...(skip || [])]);
}

// Deezer often returns no genre for a track. Bucketing those under one label
// rather than exempting them keeps the cap enforceable: an unlabeled run is
// still a run, and letting it through was how a cold pool could emit five
// straight tracks the guard never saw.
const UNLABELED_GENRE = 'Unknown';

function labelOf(track) {
  return track.genre_name || UNLABELED_GENRE;
}

// Would queueing this track make the feed feel repetitive?
function violatesDiversity(pool, track) {
  const label = labelOf(track);
  const sameGenre = pool.recentGenres.filter(g => g === label).length;
  return sameGenre >= MAX_SAME_GENRE;
}

function noteQueued(pool, track) {
  pool.recentGenres.push(labelOf(track));
  if (pool.recentGenres.length > RECENT_WINDOW) pool.recentGenres.shift();
}

// Exposed for tests only: the guard is otherwise reachable only behind a live
// Deezer fetch, and unlabeled tracks are hard to provoke on demand.
export const __test_diversity = { violatesDiversity, noteQueued, UNLABELED_GENRE };

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
function durationScore(userId, duration) {
  const pref = db.getDurationPreference(userId);
  if (!pref) return 0.5;
  const z = (duration - pref.mean) / pref.stddev;
  return Math.exp(-0.5 * z * z);
}
function popularityScore(rank) {
  return Math.min(rank / 1_000_000, 1);
}

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

async function pickBest(userId, candidates, excluded, opts = {}) {
  const { mode = 'affinity', topN = 20 } = opts;

  const eligible = candidates.filter(t => t.preview && !excluded.has(t.id));
  if (eligible.length === 0) return null;

  const scored = eligible.map(t => {
    let s;
    if (mode === 'explore') {
      // Deliberately taste-blind. Ranking exploration candidates by existing
      // affinity is what collapsed discovery back into the user's current
      // genre — the whole point here is to escape that gravity. Popularity is
      // kept at a low weight only so picks stay recognisable rather than
      // obscure, and randomness dominates.
      s = 0.25 * popularityScore(t.rank) + 0.75 * Math.random();
    } else {
      const cached   = db.getTrack(t.id);
      const genre_id = cached?.genre_id ?? null;
      s = (
        WEIGHTS.genre      * genreScore(userId, genre_id) +
        WEIGHTS.artist     * artistScore(userId, t.artist?.id) +
        WEIGHTS.duration   * durationScore(userId, t.duration) +
        WEIGHTS.popularity * popularityScore(t.rank)
      );
    }
    return { t, s };
  }).sort((a, b) => b.s - a.s);

  // Explore draws from a wider slice so we're not just re-picking the same
  // handful of "safe" tracks out of an unfamiliar genre.
  const width = mode === 'explore' ? Math.max(topN, 30) : topN;
  const pool = scored.slice(0, Math.min(width, scored.length));
  const chosen = pool[Math.floor(Math.random() * pool.length)].t;

  // Enrich only the winner (1 API call)
  const enriched  = await enrichWithGenre(chosen);
  const track     = normalizeTrack(enriched, enriched.genre_id, enriched.genre_name);
  db.upsertTrack(track);
  return track;
}

// ── Fetch strategies ──────────────────────────────────────────────────────────

async function strategyChart(userId, excluded) {
  return pickBest(userId, await getChart(50), excluded);
}

async function strategyTrackRadio(userId, excluded) {
  const likedIds = db.getRecentlyLikedTrackIds(userId, 10);
  if (likedIds.length === 0) return null;
  for (const trackId of likedIds) {
    const radio = await getTrackRadio(trackId, 25).catch(() => []);
    const track = await pickBest(userId, radio, excluded);
    if (track) return track;
  }
  return null;
}

async function strategyArtist(userId, excluded) {
  const topArtists = db.getTopArtists(userId, 0.4, 5);
  if (topArtists.length === 0) return null;
  const total = topArtists.reduce((s, a) => s + a.score, 0);
  let rand = Math.random() * total;
  let chosen = topArtists[0];
  for (const a of topArtists) { rand -= a.score; if (rand <= 0) { chosen = a; break; } }

  let artistId = chosen.artist_id;
  if (Math.random() > 0.5) {
    const related = await getRelatedArtists(artistId, 10).catch(() => []);
    if (related.length > 0) artistId = related[Math.floor(Math.random() * related.length)].id;
  }
  return pickBest(userId, await getArtistTop(artistId, 50).catch(() => []), excluded);
}

async function strategyGenre(userId, excluded) {
  const topGenres = db.getTopGenres(userId, 0.3, 5);
  if (topGenres.length === 0) return null;
  const total = topGenres.reduce((s, g) => s + g.score, 0);
  let rand = Math.random() * total;
  let chosen = topGenres[0];
  for (const g of topGenres) { rand -= g.score; if (rand <= 0) { chosen = g; break; } }
  const offset = Math.floor(Math.random() * 80);
  return pickBest(userId, await searchTracks(chosen.genre_name, 100, offset), excluded);
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

async function strategyExplore(userId, excluded) {
  // Try a couple of distant genres before giving up — a single failed search
  // used to fall straight through to the exploit strategies, which is how the
  // real exploration rate ended up well under EPSILON.
  for (let attempt = 0; attempt < 2; attempt++) {
    const genreName = pickExplorationGenre(userId);
    const offset = Math.floor(Math.random() * 50);
    const results = await searchTracks(genreName, 50, offset).catch(() => []);
    const track = await pickBest(userId, results, excluded, { mode: 'explore' });
    if (track) return track;
  }
  return null;
}

// ── Single track fetch (picks one strategy) ───────────────────────────────────

async function fetchOneTrack(userId, skip) {
  const pool     = getPool(userId);
  const excluded = getAllExcluded(userId, skip);
  const total    = db.countInteractions(userId);

  if (total < COLD_START_THRESHOLD) {
    return strategyChart(userId, excluded);
  }

  // Explore on the usual EPSILON roll, but also force one whenever we've gone
  // EXPLORE_EVERY tracks without it. The forced path is what breaks a streak;
  // random alone can go a long time without firing.
  const overdue = pool.sinceExplore >= EXPLORE_EVERY;
  if (overdue || Math.random() < EPSILON) {
    const t = await strategyExplore(userId, excluded).catch(e => { if (e.isQuota) throw e; return null; });
    if (t) {
      pool.sinceExplore = 0;
      return t;
    }
  }

  const likedCount  = db.getRecentlyLikedTrackIds(userId, 1).length;
  const artistCount = db.getTopArtists(userId, 0.4, 1).length;
  const roll = Math.random();

  const ordered = [];
  if (likedCount > 0 && roll < 0.40)       ordered.push(strategyTrackRadio, strategyArtist, strategyGenre, strategyExplore, strategyChart);
  else if (artistCount > 0 && roll < 0.65) ordered.push(strategyArtist, strategyTrackRadio, strategyGenre, strategyExplore, strategyChart);
  else                                      ordered.push(strategyGenre, strategyTrackRadio, strategyArtist, strategyExplore, strategyChart);

  for (const strategy of ordered) {
    try {
      const t = await strategy(userId, excluded);
      if (t) {
        // Only exploit strategies advance the counter; strategyExplore appearing
        // as a fallback here still counts as exploration.
        if (strategy === strategyExplore) pool.sinceExplore = 0;
        else pool.sinceExplore++;
        return t;
      }
    } catch (err) {
      if (err.isQuota) throw err; // stop immediately on quota
    }
  }
  return null;
}

// ── Pool management ───────────────────────────────────────────────────────────

async function refillPool(userId) {
  const pool = getPool(userId);
  if (pool.refilling) return;
  pool.refilling = true;

  const skip = new Set(); // diversity-rejected tracks, this refill only
  let skips = 0;

  while (pool.tracks.length < POOL_TARGET) {
    try {
      const track = await fetchOneTrack(userId, skip);
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

// ── Public API ────────────────────────────────────────────────────────────────

export async function getNextTrack(userId = 'default') {
  const pool = getPool(userId);

  // Kick off a background refill if the pool is running low
  if (pool.tracks.length < POOL_MIN && !pool.refilling) {
    refillPool(userId); // intentionally not awaited
  }

  // Serve from pool immediately if available
  if (pool.tracks.length > 0) {
    const track = pool.tracks.shift();
    pool.ids.delete(track.id);
    return track;
  }

  // Pool is empty — fetch synchronously. This path skipped the diversity guard
  // entirely, which is how a cold pool could still emit a run of same-genre
  // tracks despite the cap.
  console.log(`Pool empty for user ${userId}, fetching synchronously`);
  const skip = new Set();
  for (let attempt = 0; attempt <= MAX_DIVERSITY_SKIPS; attempt++) {
    const track = await fetchOneTrack(userId, skip);
    if (!track) return null;
    if (attempt < MAX_DIVERSITY_SKIPS && violatesDiversity(pool, track)) {
      skip.add(track.id);
      continue;
    }
    noteQueued(pool, track);
    return track;
  }
  return null;
}

// Warm up the pool for a user in the background (call at startup or first visit)
export function warmPool(userId = 'default') {
  const pool = getPool(userId);
  if (pool.tracks.length < POOL_MIN && !pool.refilling) {
    refillPool(userId);
  }
}

export function updateAffinityScores(userId, track_id) {
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
