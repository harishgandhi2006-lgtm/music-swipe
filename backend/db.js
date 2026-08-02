import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Overridable so the test run can point at a throwaway file. Without this,
// importing this module — which every service does, transitively — would open
// the developer's real database, and any test that writes would corrupt it.
const DB_PATH = process.env.MUSIC_SWIPE_DB || join(__dirname, 'music_swipe.db');
const sqlite = new DatabaseSync(DB_PATH);

sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY,
    title TEXT,
    artist_name TEXT,
    artist_id INTEGER,
    album_title TEXT,
    album_id INTEGER,
    cover_url TEXT,
    preview_url TEXT,
    genre_id INTEGER,
    genre_name TEXT,
    duration INTEGER,
    rank INTEGER,
    fetched_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    track_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('like','reject')),
    created_at INTEGER DEFAULT (unixepoch() * 1000)
  );

  -- Every read of this table is "one user's rows, newest first": the liked
  -- archive, the history log, and the recommender's seen-set exclusion. Without
  -- this they were all full scans that grew with every swipe in the database.
  CREATE INDEX IF NOT EXISTS idx_interactions_user
    ON interactions (user_id, id DESC);

  CREATE TABLE IF NOT EXISTS genre_scores (
    user_id TEXT NOT NULL,
    genre_id INTEGER NOT NULL,
    genre_name TEXT,
    likes INTEGER DEFAULT 0,
    rejects INTEGER DEFAULT 0,
    score REAL DEFAULT 0.5,
    updated_at INTEGER DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (user_id, genre_id)
  );

  CREATE TABLE IF NOT EXISTS artist_scores (
    user_id TEXT NOT NULL,
    artist_id INTEGER NOT NULL,
    artist_name TEXT,
    likes INTEGER DEFAULT 0,
    rejects INTEGER DEFAULT 0,
    score REAL DEFAULT 0.5,
    updated_at INTEGER DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (user_id, artist_id)
  );

  CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    badge_key TEXT NOT NULL,
    unlocked_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id, badge_key)
  );

  -- A user's own explicit override of the recommender's weight distribution.
  -- Each column is nullable independently ("use the default for this one"),
  -- and there is deliberately no column for anything beyond these three
  -- sliders — see effectiveWeights in recommender.js, which is what makes it
  -- structurally impossible for this table to smuggle in a forbidden signal.
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    genre_weight REAL,
    artist_weight REAL,
    exploration_rate REAL,
    updated_at INTEGER DEFAULT (unixepoch() * 1000)
  );

  -- getGenreInteractionCounts / getArtistInteractionCounts join tracks on these
  -- and run four times on every single swipe — until now, as four full scans.
  CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks (artist_id);
  CREATE INDEX IF NOT EXISTS idx_tracks_genre  ON tracks (genre_id);
`);

// ── Migration: drop the collaborative-filtering neighbor cache ───────────────
// A prior revision cached top-K taste-neighbor similarity (user_neighbors) to
// feed a CF term into the recommender. That term has been removed by policy —
// the recommendation engine is individual-input-only — and the table carried
// no data worth preserving (a pure derived cache), so it is dropped outright
// rather than left behind as dormant, unused infrastructure.
{
  const legacy = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_neighbors'"
  ).get();
  if (legacy) {
    sqlite.exec('DROP TABLE user_neighbors');
    console.log('Dropped deprecated user_neighbors table (CF removed by policy)');
  }
}

// ── Migration: drop friend-graph and crowd-signal tables ─────────────────────
// Removed by policy: friendships/shared_items implemented a friend graph, and
// track_stats aggregated swipes across all users into the recommender's
// desirability score — both are cross-user data the isolation policy forbids
// (see .claude/skills/strict-isolation/SKILL.md). shared_songs is the older,
// already-superseded name for shared_items. None of this data is
// reconstructable from what remains, so it's a hard drop, not a migration.
for (const table of ['friendships', 'shared_items', 'shared_songs', 'track_stats']) {
  const exists = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table);
  if (exists) {
    sqlite.exec(`DROP TABLE ${table}`);
    console.log(`Dropped ${table} (removed by data-isolation policy)`);
  }
}

/**
 * Per-user affinity, symmetrically smoothed.
 *
 * Was `likes / (likes + rejects + 1)`, which was mis-calibrated against the 0.5
 * prior the recommender falls back to for an unseen genre or artist. Under that
 * formula a genre with one like and no rejects also scored exactly 0.5 — no
 * better than never having been seen — and one like against one reject scored
 * 0.333, i.e. *worse* than unknown. A genre needed two likes simply to register
 * as better than silence.
 *
 * Symmetric Laplace puts the no-evidence value at 0.5 by construction, so the
 * scale now reads honestly against the prior:
 *
 *   0L 0R -> 0.500   no evidence, same as unknown
 *   1L 0R -> 0.667   one like genuinely beats silence
 *   1L 1R -> 0.500   mixed evidence lands back at neutral
 *   0L 1R -> 0.333   a reject genuinely loses to silence
 *   2L 0R -> 0.750
 *
 * The 0.5 crossover is what makes "score > 0.5" mean "liked more than rejected",
 * which is exactly what the top-genre and top-artist thresholds want to express.
 */
export function affinityScore(likes, rejects) {
  return (likes + 1) / (likes + rejects + 2);
}

// ── Normalize affinity scores to the current formula ──────────────────────────
// `score` is a pure function of the `likes`/`rejects` columns stored beside it,
// so it can always be rebuilt from them. Rows written under the previous
// formula would otherwise keep their old values until the user happened to
// swipe that genre again — and read against the new thresholds, a stale score
// silently empties the top-genre and top-artist lists the recommender steers by.
//
// Unconditional rather than version-guarded: it is idempotent, both tables are
// small, and running it every boot means the columns can never drift out of
// step with the formula again.
for (const table of ['genre_scores', 'artist_scores']) {
  sqlite.exec(`UPDATE ${table} SET score = (likes + 1.0) / (likes + rejects + 2.0)`);
}

const db = {
  // ── users ──────────────────────────────────────────────────────────────────
  createUser(username, password_hash) {
    sqlite.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, password_hash);
    return sqlite.prepare('SELECT id, username, created_at FROM users WHERE username = ?').get(username);
  },
  getUserByUsername(username) {
    return sqlite.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
  },
  getUserById(id) {
    return sqlite.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(id) || null;
  },
  // ── tracks ─────────────────────────────────────────────────────────────────
  upsertTrack(track) {
    sqlite.prepare(`
      INSERT OR REPLACE INTO tracks
        (id, title, artist_name, artist_id, album_title, album_id, cover_url, preview_url, genre_id, genre_name, duration, rank, fetched_at)
      VALUES
        (@id, @title, @artist_name, @artist_id, @album_title, @album_id, @cover_url, @preview_url, @genre_id, @genre_name, @duration, @rank, @fetched_at)
    `).run(track);
  },
  getTrack(id) {
    return sqlite.prepare('SELECT * FROM tracks WHERE id = ?').get(id) || null;
  },

  // ── interactions ────────────────────────────────────────────────────────────
  insertInteraction(userId, track_id, action) {
    const now = Date.now();
    sqlite.prepare('INSERT INTO interactions (user_id, track_id, action, created_at) VALUES (?, ?, ?, ?)').run(String(userId), track_id, action, now);
    const row = sqlite.prepare('SELECT last_insert_rowid() as id').get();
    return { id: row.id, user_id: userId, track_id, action, created_at: now };
  },
  // Undo support: removes at most the single newest matching interaction, and
  // only if it's still fresh. The freshness check is what stops an undo from
  // reaching past a track re-served much later and deleting an unrelated,
  // older swipe of the same track.
  deleteRecentInteraction(userId, track_id, withinMs) {
    const row = sqlite.prepare(
      'SELECT id, action, created_at FROM interactions WHERE user_id = ? AND track_id = ? ORDER BY id DESC LIMIT 1'
    ).get(String(userId), track_id);
    if (!row) return null;
    if (Date.now() - row.created_at > withinMs) return null;
    sqlite.prepare('DELETE FROM interactions WHERE id = ?').run(row.id);
    return row;
  },
  getSeenTrackIds(userId) {
    const rows = sqlite.prepare('SELECT DISTINCT track_id FROM interactions WHERE user_id = ?').all(String(userId));
    return new Set(rows.map(r => r.track_id));
  },
  countInteractions(userId) {
    return sqlite.prepare('SELECT COUNT(*) as n FROM interactions WHERE user_id = ?').get(String(userId)).n;
  },
  getRecentlyLikedTrackIds(userId, limit = 10) {
    return sqlite.prepare(
      "SELECT track_id FROM interactions WHERE user_id = ? AND action = 'like' ORDER BY id DESC LIMIT ?"
    ).all(String(userId), limit).map(r => r.track_id);
  },
  getHistory(userId, limit = 100) {
    return sqlite.prepare(`
      SELECT i.id, i.action, i.created_at, i.track_id,
             t.title, t.artist_name, t.cover_url, t.genre_name
      FROM interactions i
      LEFT JOIN tracks t ON t.id = i.track_id
      WHERE i.user_id = ?
      ORDER BY i.id DESC LIMIT ?
    `).all(String(userId), limit);
  },

  // ── session window ──────────────────────────────────────────────────────────
  // Swipes belonging to the *current* sitting: everything newer than the most
  // recent gap longer than `gapMs`.
  //
  // Derived here rather than read from the client's session log, which is
  // sessionStorage-only by design, deduped by track_id (so it loses repeat
  // swipes — exactly the signal momentum needs), and forgeable besides.
  //
  // LAG over `id DESC` yields the *newer* neighbour, so `newer_at - created_at`
  // is the forward gap. The inner MAX(id) is the newest row sitting on the far
  // side of a break; anything above it belongs to this session. COALESCE(...,0)
  // covers "no break inside the window" — the whole window is one session.
  // Rides idx_interactions_user as a bounded index scan, so cost is independent
  // of how much history exists.
  getSessionSwipes(userId, gapMs = 1_800_000, maxRows = 40) {
    return sqlite.prepare(`
      WITH recent AS (
        SELECT i.id, i.action, i.created_at,
               t.genre_id, t.genre_name, t.artist_id
        FROM interactions i
        LEFT JOIN tracks t ON t.id = i.track_id
        WHERE i.user_id = ?
        ORDER BY i.id DESC
        LIMIT ?
      ),
      gapped AS (
        SELECT *, LAG(created_at) OVER (ORDER BY id DESC) AS newer_at FROM recent
      )
      SELECT id, action, created_at, genre_id, genre_name, artist_id
      FROM gapped
      WHERE id > COALESCE(
        (SELECT MAX(id) FROM gapped
          WHERE newer_at IS NOT NULL AND newer_at - created_at > ?), 0)
      ORDER BY id DESC
    `).all(String(userId), maxRows, gapMs);
  },

  // The last few tracks this user actually swiped, for rebuilding the fatigue
  // window after a process restart (the in-memory pool doesn't survive one).
  getRecentContext(userId, limit = 10) {
    return sqlite.prepare(`
      SELECT t.artist_id, t.album_id, t.genre_name
      FROM interactions i
      JOIN tracks t ON t.id = i.track_id
      WHERE i.user_id = ?
      ORDER BY i.id DESC LIMIT ?
    `).all(String(userId), limit);
  },

  // ── liked archive ───────────────────────────────────────────────────────────
  // The permanent layer: every track this user has ever liked, newest first.
  //
  // Grouped by track_id rather than returned per row, because this is a library
  // of songs and not a log of events — a song liked twice (via Discover and
  // again from a friend's share in the inbox) should occupy one slot, at the
  // time of the most recent like. getHistory above is the event log.
  //
  // INNER JOIN is deliberate: a like whose track row is missing has no title or
  // artwork to render, so it would only ever paint an empty shelf.
  getLikedArchive(userId, limit = 50, offset = 0) {
    return sqlite.prepare(`
      SELECT MAX(i.id) AS id, MAX(i.created_at) AS liked_at, i.track_id,
             t.title, t.artist_name, t.artist_id, t.album_title,
             t.cover_url, t.genre_name, t.duration
      FROM interactions i
      JOIN tracks t ON t.id = i.track_id
      WHERE i.user_id = ? AND i.action = 'like'
      GROUP BY i.track_id
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(String(userId), limit, offset);
  },

  // DISTINCT to match the grouping above, so the total agrees with what
  // paging through getLikedArchive actually yields.
  countLikedArchive(userId) {
    return sqlite.prepare(
      "SELECT COUNT(DISTINCT track_id) AS n FROM interactions WHERE user_id = ? AND action = 'like'"
    ).get(String(userId)).n;
  },

  // ── genre scores ────────────────────────────────────────────────────────────
  upsertGenreScore(userId, genre_id, genre_name, likes, rejects) {
    const score = affinityScore(likes, rejects);
    sqlite.prepare(`
      INSERT INTO genre_scores (user_id, genre_id, genre_name, likes, rejects, score, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, genre_id) DO UPDATE SET
        genre_name = excluded.genre_name, likes = excluded.likes,
        rejects = excluded.rejects, score = excluded.score, updated_at = excluded.updated_at
    `).run(String(userId), genre_id, genre_name, likes, rejects, score, Date.now());
  },
  getGenreScore(userId, genre_id) {
    return sqlite.prepare('SELECT score FROM genre_scores WHERE user_id = ? AND genre_id = ?').get(String(userId), genre_id)?.score ?? null;
  },
  getGenreScores(userId) {
    return sqlite.prepare('SELECT * FROM genre_scores WHERE user_id = ? ORDER BY score DESC').all(String(userId));
  },
  // 0.5 is the crossover under affinityScore: above it means strictly more
  // likes than rejects. The old 0.3 was tuned to the old curve — carried over
  // unchanged it would have admitted a genre with a single reject.
  getTopGenres(userId, minScore = 0.5, limit = 5) {
    return sqlite.prepare(
      'SELECT * FROM genre_scores WHERE user_id = ? AND score > ? AND likes > 0 ORDER BY score DESC LIMIT ?'
    ).all(String(userId), minScore, limit);
  },
  getTouchedGenreNames(userId) {
    const rows = sqlite.prepare(`
      SELECT DISTINCT t.genre_name FROM interactions i
      JOIN tracks t ON t.id = i.track_id
      WHERE i.user_id = ? AND t.genre_name IS NOT NULL
    `).all(String(userId));
    return new Set(rows.map(r => r.genre_name));
  },
  getGenreInteractionCounts(userId, genre_id) {
    const likes = sqlite.prepare(
      "SELECT COUNT(*) as n FROM interactions i JOIN tracks t ON t.id = i.track_id WHERE i.user_id = ? AND t.genre_id = ? AND i.action = 'like'"
    ).get(String(userId), genre_id)?.n || 0;
    const rejects = sqlite.prepare(
      "SELECT COUNT(*) as n FROM interactions i JOIN tracks t ON t.id = i.track_id WHERE i.user_id = ? AND t.genre_id = ? AND i.action = 'reject'"
    ).get(String(userId), genre_id)?.n || 0;
    return { likes, rejects };
  },

  // ── artist scores ───────────────────────────────────────────────────────────
  upsertArtistScore(userId, artist_id, artist_name, likes, rejects) {
    const score = affinityScore(likes, rejects);
    sqlite.prepare(`
      INSERT INTO artist_scores (user_id, artist_id, artist_name, likes, rejects, score, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, artist_id) DO UPDATE SET
        artist_name = excluded.artist_name, likes = excluded.likes,
        rejects = excluded.rejects, score = excluded.score, updated_at = excluded.updated_at
    `).run(String(userId), artist_id, artist_name, likes, rejects, score, Date.now());
  },
  getArtistScore(userId, artist_id) {
    return sqlite.prepare('SELECT score FROM artist_scores WHERE user_id = ? AND artist_id = ?').get(String(userId), artist_id)?.score ?? null;
  },
  getArtistScores(userId) {
    return sqlite.prepare('SELECT * FROM artist_scores WHERE user_id = ? ORDER BY score DESC').all(String(userId));
  },
  // Held slightly above the genre bar, preserving the relative strictness the
  // old 0.4-vs-0.3 pairing encoded: artist affinity is a narrower claim, so it
  // should need marginally more evidence than genre affinity.
  getTopArtists(userId, minScore = 0.55, limit = 5) {
    return sqlite.prepare(
      'SELECT * FROM artist_scores WHERE user_id = ? AND score > ? AND likes > 0 ORDER BY score DESC LIMIT ?'
    ).all(String(userId), minScore, limit);
  },
  getArtistInteractionCounts(userId, artist_id) {
    const likes = sqlite.prepare(
      "SELECT COUNT(*) as n FROM interactions i JOIN tracks t ON t.id = i.track_id WHERE i.user_id = ? AND t.artist_id = ? AND i.action = 'like'"
    ).get(String(userId), artist_id)?.n || 0;
    const rejects = sqlite.prepare(
      "SELECT COUNT(*) as n FROM interactions i JOIN tracks t ON t.id = i.track_id WHERE i.user_id = ? AND t.artist_id = ? AND i.action = 'reject'"
    ).get(String(userId), artist_id)?.n || 0;
    return { likes, rejects };
  },

  // ── duration preference ─────────────────────────────────────────────────────
  getDurationPreference(userId) {
    const durations = sqlite.prepare(`
      SELECT t.duration FROM interactions i
      JOIN tracks t ON t.id = i.track_id
      WHERE i.user_id = ? AND i.action = 'like' AND t.duration > 0
    `).all(String(userId)).map(r => r.duration);
    if (durations.length < 3) return null;
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    const variance = durations.reduce((s, d) => s + (d - mean) ** 2, 0) / durations.length;
    return { mean, stddev: Math.max(Math.sqrt(variance), 30) };
  },

  // ── user preferences ─────────────────────────────────────────────────────────
  getUserPreferences(userId) {
    return sqlite.prepare(
      'SELECT genre_weight, artist_weight, exploration_rate FROM user_preferences WHERE user_id = ?'
    ).get(String(userId)) || null;
  },
  upsertUserPreferences(userId, { genre_weight, artist_weight, exploration_rate }) {
    sqlite.prepare(`
      INSERT INTO user_preferences (user_id, genre_weight, artist_weight, exploration_rate, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        genre_weight = excluded.genre_weight, artist_weight = excluded.artist_weight,
        exploration_rate = excluded.exploration_rate, updated_at = excluded.updated_at
    `).run(String(userId), genre_weight ?? null, artist_weight ?? null, exploration_rate ?? null, Date.now());
  },

  // ── badges ──────────────────────────────────────────────────────────────────
  unlockBadge(userId, badgeKey) {
    const result = sqlite.prepare('INSERT OR IGNORE INTO badges (user_id, badge_key) VALUES (?, ?)').run(userId, badgeKey);
    return result.changes === 1;
  },
  getUserBadges(userId) {
    return sqlite.prepare('SELECT badge_key, unlocked_at FROM badges WHERE user_id = ?').all(userId);
  },

  // ── profile ─────────────────────────────────────────────────────────────────
  getUserProfile(userId) {
    const strId = String(userId);
    const totalLikes = sqlite.prepare('SELECT SUM(likes) as n FROM genre_scores WHERE user_id = ?').get(strId)?.n || 1;

    const genres = sqlite.prepare(`
      SELECT genre_name, likes, rejects, score,
             CAST(likes AS REAL) / ? as pct
      FROM genre_scores
      WHERE user_id = ? AND likes > 0
      ORDER BY likes DESC LIMIT 8
    `).all(totalLikes, strId);

    // Artwork comes from the artist's highest-ranked cached track — artist_scores
    // has no images of its own.
    const artists = sqlite.prepare(`
      SELECT s.artist_name, s.artist_id, s.likes,
             (SELECT t.cover_url FROM tracks t
               WHERE t.artist_id = s.artist_id AND t.cover_url != ''
               ORDER BY t.rank DESC LIMIT 1) as cover_url
      FROM artist_scores s
      WHERE s.user_id = ? AND s.likes > 0
      ORDER BY s.likes DESC LIMIT 10
    `).all(strId);

    const badges = sqlite.prepare('SELECT badge_key, unlocked_at FROM badges WHERE user_id = ?').all(userId);
    return { genres, artists, badges };
  },
};

export default db;
