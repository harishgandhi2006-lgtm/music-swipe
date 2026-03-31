import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'music_swipe.json');

function loadDB() {
  if (!existsSync(DB_PATH)) {
    return { tracks: {}, interactions: [], genre_scores: {}, artist_scores: {}, _nextId: 1 };
  }
  const data = JSON.parse(readFileSync(DB_PATH, 'utf-8'));
  if (!data.artist_scores) data.artist_scores = {};
  // Migrate old interactions that lack user_id
  data.interactions = data.interactions.map(i => ({ user_id: 'default', ...i }));
  return data;
}

function saveDB(data) {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

let _db = loadDB();

// ── helpers ────────────────────────────────────────────────────────────────────
const key = (userId, id) => `${userId}::${id}`;

const db = {
  // ── tracks (shared cache, not per-user) ───────────────────────────────────
  upsertTrack(track) {
    _db.tracks[track.id] = track;
    saveDB(_db);
  },
  getTrack(id) { return _db.tracks[id] || null; },

  // ── interactions ──────────────────────────────────────────────────────────
  insertInteraction(userId, track_id, action) {
    const row = { id: _db._nextId++, user_id: userId, track_id, action, created_at: Date.now() };
    _db.interactions.push(row);
    saveDB(_db);
    return row;
  },
  userInteractions(userId) {
    return _db.interactions.filter(i => i.user_id === userId);
  },
  getSeenTrackIds(userId) {
    return new Set(this.userInteractions(userId).map(i => i.track_id));
  },
  countInteractions(userId) {
    return this.userInteractions(userId).length;
  },
  getRecentlyLikedTrackIds(userId, limit = 10) {
    return this.userInteractions(userId)
      .filter(i => i.action === 'like')
      .reverse()
      .slice(0, limit)
      .map(i => i.track_id);
  },
  getHistory(userId, limit = 100) {
    return this.userInteractions(userId)
      .reverse()
      .slice(0, limit)
      .map(i => {
        const t = _db.tracks[i.track_id] || {};
        return { id: i.id, action: i.action, created_at: i.created_at,
          track_id: i.track_id, title: t.title, artist_name: t.artist_name,
          cover_url: t.cover_url, genre_name: t.genre_name };
      });
  },

  // ── genre scores (per user) ───────────────────────────────────────────────
  upsertGenreScore(userId, genre_id, genre_name, likes, rejects) {
    const score = likes / (likes + rejects + 1);
    _db.genre_scores[key(userId, genre_id)] = { userId, genre_id, genre_name, likes, rejects, score, updated_at: Date.now() };
    saveDB(_db);
  },
  getGenreScore(userId, genre_id) {
    return _db.genre_scores[key(userId, genre_id)]?.score ?? null;
  },
  getGenreScores(userId) {
    return Object.values(_db.genre_scores).filter(g => g.userId === userId).sort((a, b) => b.score - a.score);
  },
  getTopGenres(userId, minScore = 0.3, limit = 5) {
    return Object.values(_db.genre_scores)
      .filter(g => g.userId === userId && g.score > minScore && g.likes > 0)
      .sort((a, b) => b.score - a.score).slice(0, limit);
  },
  getTouchedGenreNames(userId) {
    return new Set(this.userInteractions(userId)
      .map(i => _db.tracks[i.track_id]?.genre_name).filter(Boolean));
  },
  getGenreInteractionCounts(userId, genre_id) {
    const r = this.userInteractions(userId).filter(i => _db.tracks[i.track_id]?.genre_id === genre_id);
    return { likes: r.filter(i => i.action === 'like').length, rejects: r.filter(i => i.action === 'reject').length };
  },

  // ── artist scores (per user) ──────────────────────────────────────────────
  upsertArtistScore(userId, artist_id, artist_name, likes, rejects) {
    const score = likes / (likes + rejects + 1);
    _db.artist_scores[key(userId, artist_id)] = { userId, artist_id, artist_name, likes, rejects, score, updated_at: Date.now() };
    saveDB(_db);
  },
  getArtistScore(userId, artist_id) {
    return _db.artist_scores[key(userId, artist_id)]?.score ?? null;
  },
  getArtistScores(userId) {
    return Object.values(_db.artist_scores).filter(a => a.userId === userId).sort((a, b) => b.score - a.score);
  },
  getTopArtists(userId, minScore = 0.4, limit = 5) {
    return Object.values(_db.artist_scores)
      .filter(a => a.userId === userId && a.score > minScore && a.likes > 0)
      .sort((a, b) => b.score - a.score).slice(0, limit);
  },
  getArtistInteractionCounts(userId, artist_id) {
    const r = this.userInteractions(userId).filter(i => _db.tracks[i.track_id]?.artist_id === artist_id);
    return { likes: r.filter(i => i.action === 'like').length, rejects: r.filter(i => i.action === 'reject').length };
  },

  // ── duration preference ───────────────────────────────────────────────────
  getDurationPreference(userId) {
    const durations = this.userInteractions(userId)
      .filter(i => i.action === 'like')
      .map(i => _db.tracks[i.track_id]?.duration)
      .filter(d => d != null && d > 0);
    if (durations.length < 3) return null;
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    const variance = durations.reduce((s, d) => s + (d - mean) ** 2, 0) / durations.length;
    return { mean, stddev: Math.max(Math.sqrt(variance), 30) };
  },
};

export default db;
