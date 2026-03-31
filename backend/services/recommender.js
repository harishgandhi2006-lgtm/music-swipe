import db from '../db.js';
import { getChart, searchTracks, getAlbum, getArtistTop, getTrackRadio, getRelatedArtists } from './deezer.js';

// ── Config ────────────────────────────────────────────────────────────────────

const COLD_START_THRESHOLD = 5;
const EPSILON = 0.20;
const POOL_TARGET = 12;   // keep this many tracks ready per user
const POOL_MIN    = 4;    // refill when below this
const QUOTA_RETRY_MS = 8000; // wait before retrying after quota error

const WEIGHTS = { genre: 0.30, artist: 0.30, duration: 0.20, popularity: 0.20 };

const EXPLORATION_GENRES = [
  'Pop', 'Rock', 'Hip Hop', 'Electronic', 'Jazz', 'R&B', 'Classical',
  'Country', 'Metal', 'Soul', 'Reggae', 'Blues', 'Folk', 'Latin', 'Dance',
  'Punk', 'Alternative', 'Indie', 'House', 'Techno', 'Funk', 'Gospel',
];

// ── Per-user pool ─────────────────────────────────────────────────────────────
// Map<userId, { tracks: Track[], ids: Set<number>, refilling: boolean }>
const pools = new Map();

function getPool(userId) {
  if (!pools.has(userId)) {
    pools.set(userId, { tracks: [], ids: new Set(), refilling: false });
  }
  return pools.get(userId);
}

// All IDs the recommender should not return for this user
function getAllExcluded(userId) {
  const interacted = db.getSeenTrackIds(userId);
  const pooled     = getPool(userId).ids;
  return new Set([...interacted, ...pooled]);
}

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

async function pickBest(userId, candidates, excluded, topN = 20) {
  const eligible = candidates.filter(t => t.preview && !excluded.has(t.id));
  if (eligible.length === 0) return null;

  const scored = eligible.map(t => {
    const cached   = db.getTrack(t.id);
    const genre_id = cached?.genre_id ?? null;
    const s = (
      WEIGHTS.genre      * genreScore(userId, genre_id) +
      WEIGHTS.artist     * artistScore(userId, t.artist?.id) +
      WEIGHTS.duration   * durationScore(userId, t.duration) +
      WEIGHTS.popularity * popularityScore(t.rank)
    );
    return { t, s };
  }).sort((a, b) => b.s - a.s);

  const pool = scored.slice(0, Math.min(topN, scored.length));
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

async function strategyExplore(userId, excluded) {
  const touched    = db.getTouchedGenreNames(userId);
  const unexplored = EXPLORATION_GENRES.filter(g => !touched.has(g));
  let genreName;
  if (unexplored.length > 0) {
    genreName = unexplored[Math.floor(Math.random() * unexplored.length)];
  } else {
    const scores = db.getGenreScores(userId);
    const bottom = scores.slice(-5);
    genreName = bottom.length > 0
      ? bottom[Math.floor(Math.random() * bottom.length)].genre_name
      : EXPLORATION_GENRES[Math.floor(Math.random() * EXPLORATION_GENRES.length)];
  }
  const offset = Math.floor(Math.random() * 50);
  return pickBest(userId, await searchTracks(genreName, 50, offset), excluded);
}

// ── Single track fetch (picks one strategy) ───────────────────────────────────

async function fetchOneTrack(userId) {
  const excluded = getAllExcluded(userId);
  const total    = db.countInteractions(userId);

  if (total < COLD_START_THRESHOLD) {
    return strategyChart(userId, excluded);
  }

  if (Math.random() < EPSILON) {
    const t = await strategyExplore(userId, excluded).catch(e => { if (e.isQuota) throw e; return null; });
    if (t) return t;
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
      if (t) return t;
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

  while (pool.tracks.length < POOL_TARGET) {
    try {
      const track = await fetchOneTrack(userId);
      if (!track) break; // no more unique tracks available right now
      if (!pool.ids.has(track.id)) {
        pool.tracks.push(track);
        pool.ids.add(track.id);
      }
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

  // Pool is empty — fetch one track synchronously (only happens on first load)
  console.log(`Pool empty for user ${userId}, fetching synchronously`);
  return fetchOneTrack(userId);
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
