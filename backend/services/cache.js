import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';

// Two-tier cache — see ARCHITECTURE.md for the reasoning behind the split.
//
// L1 (in-process LRU): track metadata. Rows only change on db.upsertTrack,
// which is rare and process-local anyway, so a slightly stale in-process
// copy costs nothing and avoids both a SQLite hit and a Redis round-trip
// for the popular tracks that recur across many users' pools.
//
// L2 (Redis): per-user affinity data. This changes per-user over the
// session and must stay consistent across whichever server process handles
// that user's next request, so it needs a tier shared across the fleet
// rather than in-process.
//
// L2 no-ops to a pass-through when REDIS_URL is unset, so local dev and the
// test suite (which redirects MUSIC_SWIPE_DB to a throwaway file via
// test/setup.js) don't gain a hard Redis dependency.

const trackCache = new LRUCache({ max: 5000, ttl: 60 * 60 * 1000 });

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true }) : null;
if (redis) {
  redis.connect().catch(err => {
    console.error('Redis connection failed, L2 cache disabled:', err.message);
  });
}

function redisReady() {
  return redis !== null && redis.status === 'ready';
}

export const trackMetaCache = {
  get(id) {
    return trackCache.get(id) ?? null;
  },
  getMany(ids) {
    const hits = new Map();
    const missing = [];
    for (const id of ids) {
      const cached = trackCache.get(id);
      if (cached !== undefined) hits.set(id, cached);
      else missing.push(id);
    }
    return { hits, missing };
  },
  set(id, track) {
    trackCache.set(id, track);
  },
  setMany(tracksById) {
    for (const [id, track] of tracksById) trackCache.set(id, track);
  },
  del(id) {
    trackCache.delete(id);
  },
};

const AFFINITY_TTL_SECONDS = 45;

export const affinityCache = {
  async getGenreScores(userId) {
    if (!redisReady()) return null;
    try {
      const raw = await redis.get(`genre_scores:${userId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async setGenreScores(userId, scores) {
    if (!redisReady()) return;
    try {
      await redis.set(`genre_scores:${userId}`, JSON.stringify(scores), 'EX', AFFINITY_TTL_SECONDS);
    } catch {
      // Cache write failures are non-fatal — SQLite remains the source of truth.
    }
  },
  async getArtistScores(userId) {
    if (!redisReady()) return null;
    try {
      const raw = await redis.get(`artist_scores:${userId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async setArtistScores(userId, scores) {
    if (!redisReady()) return;
    try {
      await redis.set(`artist_scores:${userId}`, JSON.stringify(scores), 'EX', AFFINITY_TTL_SECONDS);
    } catch {
      // Cache write failures are non-fatal — SQLite remains the source of truth.
    }
  },
  async invalidate(userId) {
    if (!redisReady()) return;
    try {
      await redis.del(`genre_scores:${userId}`, `artist_scores:${userId}`);
    } catch {
      // Non-fatal — a stale cache entry expires on its own via TTL.
    }
  },
};
