import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlite = new DatabaseSync(join(__dirname, 'music_swipe.db'));

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

  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id_1 INTEGER NOT NULL REFERENCES users(id),
    user_id_2 INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined')),
    requester_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id_1, user_id_2)
  );

  CREATE TABLE IF NOT EXISTS shared_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    receiver_id INTEGER NOT NULL REFERENCES users(id),
    item_type TEXT NOT NULL CHECK(item_type IN ('track','artist')),
    item_id INTEGER NOT NULL,
    message TEXT,
    seen INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_shared_items_receiver
    ON shared_items (receiver_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    badge_key TEXT NOT NULL,
    unlocked_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id, badge_key)
  );
`);

// ── Migration: shared_songs → shared_items ────────────────────────────────────
// The old table was track-only. Carry any existing rows over as 'track' shares
// before dropping it. Runs once; the DROP is what makes it idempotent.
{
  const legacy = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shared_songs'"
  ).get();

  if (legacy) {
    const carried = sqlite.prepare('SELECT COUNT(*) as n FROM shared_songs').get().n;
    sqlite.exec(`
      INSERT INTO shared_items (id, sender_id, receiver_id, item_type, item_id, message, seen, created_at)
        SELECT id, sender_id, receiver_id, 'track', track_id, message, seen, created_at
        FROM shared_songs;
      DROP TABLE shared_songs;
    `);
    console.log(`Migrated ${carried} row(s) from shared_songs to shared_items`);
  }
}

// Collapse flat score rows into Map<userId, Map<key, { likes, name }>>
function groupVectors(rows, keyCol, nameCol) {
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.uid)) byUser.set(r.uid, new Map());
    byUser.get(r.uid).set(r[keyCol], { likes: r.likes, name: r[nameCol] });
  }
  return byUser;
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
  searchUsers(query, excludeId) {
    return sqlite.prepare(
      "SELECT id, username FROM users WHERE username LIKE ? AND id != ? LIMIT 20"
    ).all(`%${query}%`, excludeId);
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

  // ── genre scores ────────────────────────────────────────────────────────────
  upsertGenreScore(userId, genre_id, genre_name, likes, rejects) {
    const score = likes / (likes + rejects + 1);
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
  getTopGenres(userId, minScore = 0.3, limit = 5) {
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
    const score = likes / (likes + rejects + 1);
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
  getTopArtists(userId, minScore = 0.4, limit = 5) {
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

  // ── friendships ─────────────────────────────────────────────────────────────
  sendFriendRequest(requesterId, targetId) {
    const [uid1, uid2] = [Math.min(requesterId, targetId), Math.max(requesterId, targetId)];
    sqlite.prepare(`
      INSERT OR IGNORE INTO friendships (user_id_1, user_id_2, status, requester_id)
      VALUES (?, ?, 'pending', ?)
    `).run(uid1, uid2, requesterId);
  },
  respondFriendRequest(friendshipId, responderId, status) {
    const f = sqlite.prepare('SELECT * FROM friendships WHERE id = ?').get(friendshipId);
    if (!f) return null;
    if (f.requester_id === responderId) return null;
    if (f.user_id_1 !== responderId && f.user_id_2 !== responderId) return null;
    sqlite.prepare('UPDATE friendships SET status = ?, updated_at = unixepoch() WHERE id = ?').run(status, friendshipId);
    return sqlite.prepare('SELECT * FROM friendships WHERE id = ?').get(friendshipId);
  },
  getFriends(userId) {
    return sqlite.prepare(`
      SELECT f.id as friendship_id,
        CASE WHEN f.user_id_1 = ? THEN u2.id       ELSE u1.id       END as friend_id,
        CASE WHEN f.user_id_1 = ? THEN u2.username ELSE u1.username END as friend_username
      FROM friendships f
      JOIN users u1 ON u1.id = f.user_id_1
      JOIN users u2 ON u2.id = f.user_id_2
      WHERE (f.user_id_1 = ? OR f.user_id_2 = ?) AND f.status = 'accepted'
    `).all(userId, userId, userId, userId);
  },
  getPendingRequests(userId) {
    return sqlite.prepare(`
      SELECT f.id as friendship_id, f.requester_id, u.username as requester_username, f.created_at
      FROM friendships f
      JOIN users u ON u.id = f.requester_id
      WHERE (f.user_id_1 = ? OR f.user_id_2 = ?)
        AND f.status = 'pending' AND f.requester_id != ?
    `).all(userId, userId, userId);
  },
  removeFriend(friendshipId, userId) {
    const f = sqlite.prepare('SELECT * FROM friendships WHERE id = ?').get(friendshipId);
    if (!f || (f.user_id_1 !== userId && f.user_id_2 !== userId)) return false;
    sqlite.prepare('DELETE FROM friendships WHERE id = ?').run(friendshipId);
    return true;
  },
  getFriendshipStatus(userId1, userId2) {
    const [uid1, uid2] = [Math.min(userId1, userId2), Math.max(userId1, userId2)];
    return sqlite.prepare('SELECT * FROM friendships WHERE user_id_1 = ? AND user_id_2 = ?').get(uid1, uid2) || null;
  },

  // ── taste matching ──────────────────────────────────────────────────────────
  // Users who aren't `userId`, aren't already connected (pending or accepted),
  // and have enough swipe history to compare against.
  getTasteMatchCandidates(userId, minLikes = 5) {
    return sqlite.prepare(`
      SELECT u.id, u.username
      FROM users u
      WHERE u.id != ?
        AND u.id NOT IN (
          SELECT CASE WHEN f.user_id_1 = ? THEN f.user_id_2 ELSE f.user_id_1 END
          FROM friendships f
          WHERE (f.user_id_1 = ? OR f.user_id_2 = ?)
            AND f.status IN ('pending', 'accepted')
        )
        AND (
          SELECT COALESCE(SUM(gs.likes), 0)
          FROM genre_scores gs
          WHERE gs.user_id = CAST(u.id AS TEXT)
        ) >= ?
    `).all(userId, userId, userId, userId, minLikes);
  },

  // Liked-genre vectors for a set of users, keyed by user id.
  // user_id is TEXT here but INTEGER in users — cast on the way out.
  getGenreVectors(userIds) {
    if (userIds.length === 0) return new Map();
    const placeholders = userIds.map(() => '?').join(',');
    const rows = sqlite.prepare(`
      SELECT CAST(user_id AS INTEGER) as uid, genre_id, genre_name, likes
      FROM genre_scores
      WHERE user_id IN (${placeholders}) AND likes > 0
    `).all(...userIds.map(String));
    return groupVectors(rows, 'genre_id', 'genre_name');
  },

  getArtistVectors(userIds) {
    if (userIds.length === 0) return new Map();
    const placeholders = userIds.map(() => '?').join(',');
    const rows = sqlite.prepare(`
      SELECT CAST(user_id AS INTEGER) as uid, artist_id, artist_name, likes
      FROM artist_scores
      WHERE user_id IN (${placeholders}) AND likes > 0
    `).all(...userIds.map(String));
    return groupVectors(rows, 'artist_id', 'artist_name');
  },

  // ── shared items (tracks + artists) ─────────────────────────────────────────
  shareItem(senderId, receiverId, itemType, itemId, message = null) {
    sqlite.prepare(`
      INSERT INTO shared_items (sender_id, receiver_id, item_type, item_id, message)
      VALUES (?, ?, ?, ?, ?)
    `).run(senderId, receiverId, itemType, itemId, message);
    return sqlite.prepare('SELECT last_insert_rowid() as id').get().id;
  },

  // We only store artist metadata as a side effect of caching tracks, so an
  // artist share resolves its name/artwork from any track by that artist.
  getArtistMeta(artistId) {
    return sqlite.prepare(`
      SELECT artist_id, artist_name, cover_url, genre_name
      FROM tracks
      WHERE artist_id = ? AND artist_name != ''
      ORDER BY rank DESC
      LIMIT 1
    `).get(artistId) || null;
  },

  getInbox(userId) {
    return sqlite.prepare(`
      SELECT si.id, si.sender_id, si.item_type, si.item_id, si.message, si.seen, si.created_at,
             u.username as sender_username,
             t.title, t.cover_url, t.preview_url, t.duration,
             COALESCE(t.artist_name, a.artist_name) as artist_name,
             COALESCE(t.genre_name,  a.genre_name)  as genre_name,
             a.cover_url as artist_cover
      FROM shared_items si
      JOIN users u ON u.id = si.sender_id
      LEFT JOIN tracks t
        ON si.item_type = 'track' AND t.id = si.item_id
      LEFT JOIN (
        SELECT artist_id, artist_name, genre_name, cover_url,
               ROW_NUMBER() OVER (PARTITION BY artist_id ORDER BY rank DESC) as rn
        FROM tracks
        WHERE artist_name != ''
      ) a ON si.item_type = 'artist' AND a.artist_id = si.item_id AND a.rn = 1
      WHERE si.receiver_id = ?
      ORDER BY si.created_at DESC, si.id DESC
    `).all(userId);
  },

  markSeen(sharedItemId, userId) {
    sqlite.prepare('UPDATE shared_items SET seen = 1 WHERE id = ? AND receiver_id = ?').run(sharedItemId, userId);
  },

  getUnseenCount(userId) {
    return sqlite.prepare('SELECT COUNT(*) as n FROM shared_items WHERE receiver_id = ? AND seen = 0').get(userId)?.n || 0;
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
