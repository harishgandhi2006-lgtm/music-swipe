import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __test_momentum as M } from '../services/recommender.js';

// Exercises the serve-time re-ranker directly. An API-level A/B cannot detect
// momentum: re-ranking reorders the pool rather than changing what is fetched
// into it, so aggregate genre share over a long run is governed by fetching.
// Position is the effect, so position is what these assert.

const USER = '__rerank_probe__'; // no rows anywhere, so affinity terms are neutral
const NOW = Date.now();

// Pooled tracks are normalized Track objects.
const t = (id, genre_id, genre_name, artist_id, via = 'exploit') => ({
  id, genre_id, genre_name, artist_id, album_id: id * 10,
  duration: 200, rank: 500_000, via,
});

const hotPop = (n) => Array.from({ length: n }, () => ({
  action: 'like', genre_id: 132, genre_name: 'Pop', artist_id: 55, created_at: NOW,
}));

const poolWith = (tracks, momentum) => {
  const pool = M.makePool(tracks);
  pool.momentumCache = { at: NOW, value: momentum };
  return pool;
};
const NEUTRAL = M.EMPTY_MOMENTUM;
const HOT = M.momentumFrom(hotPop(5), NOW);

describe('no momentum', () => {
  it('serves the head, preserving FIFO order', () => {
    const pool = poolWith([t(1, 900, 'Jazz', 11), t(2, 132, 'Pop', 55), t(3, 901, 'Rock', 12)], NEUTRAL);
    assert.equal(M.reRankAndServe(USER, pool).id, 1);
  });
});

describe('momentum reorders the queue', () => {
  it('promotes a track in the streak genre over the head', () => {
    const pool = poolWith([t(1, 900, 'Jazz', 11), t(2, 132, 'Pop', 55), t(3, 901, 'Rock', 12)], HOT);
    assert.equal(M.reRankAndServe(USER, pool).id, 2);
  });

  it('removes the served track from the pool', () => {
    const pool = poolWith([t(1, 900, 'Jazz', 11), t(2, 132, 'Pop', 55), t(3, 901, 'Rock', 12)], HOT);
    M.reRankAndServe(USER, pool);
    assert.equal(pool.tracks.some(x => x.id === 2), false);
  });

  it('gives every skipped track starvation credit', () => {
    const pool = poolWith([t(1, 900, 'Jazz', 11), t(2, 132, 'Pop', 55), t(3, 901, 'Rock', 12)], HOT);
    M.reRankAndServe(USER, pool);
    assert.ok(pool.tracks.every(x => x.passedOver === 1));
  });
});

describe('exploration immunity', () => {
  // Without this a hot streak sinks every discovery pick to the bottom of the
  // tail, and the realized explore rate quietly falls below EPSILON.
  it('explore tracks ignore momentum entirely', () => {
    const pool = poolWith([
      t(1, 900, 'Jazz', 11, 'explore'),
      t(2, 132, 'Pop', 55, 'explore'),
      t(3, 901, 'Rock', 12, 'explore'),
    ], HOT);
    assert.equal(M.reRankAndServe(USER, pool).id, 1);
  });
});

describe('exploration floor', () => {
  const atThreshold = () => {
    const pool = poolWith(
      [t(1, 132, 'Pop', 55), t(2, 132, 'Pop', 56), t(3, 900, 'Jazz', 11, 'explore')], HOT);
    pool.sinceExploreServed = 4; // EXPLORE_EVERY
    return pool;
  };

  it('force-serves discovery despite a hot streak', () => {
    assert.equal(M.reRankAndServe(USER, atThreshold()).via, 'explore');
  });

  it('resets the counter once discovery is served', () => {
    const pool = atThreshold();
    M.reRankAndServe(USER, pool);
    assert.equal(pool.sinceExploreServed, 0);
  });
});

describe('serve-time gates', () => {
  // The served window holds context objects, not bare genre labels, so artist
  // and album runs are policed in serve order too.
  const servedCtx = (genre, artistId, albumId) => ({ genre, family: null, artistId, albumId });

  it('refuses a third consecutive same-genre track, despite momentum', () => {
    const pool = poolWith(
      [t(1, 132, 'Pop', 55), t(2, 132, 'Pop', 56), t(3, 900, 'Jazz', 11)], HOT);
    pool.served = [servedCtx('Pop', 91, 910), servedCtx('Pop', 92, 920)];
    assert.equal(M.reRankAndServe(USER, pool).genre_name, 'Jazz');
  });

  it('refuses a third track by an artist already served twice', () => {
    const pool = poolWith([t(1, 132, 'Pop', 55), t(2, 900, 'Jazz', 11)], HOT);
    pool.served = [servedCtx('Rock', 55, 8001), servedCtx('Rock', 55, 8002)];
    assert.equal(M.reRankAndServe(USER, pool).artist_id, 11);
  });

  it('refuses a second cut from an album already served', () => {
    // t(1) carries album_id 10 by construction.
    const pool = poolWith([t(1, 132, 'Pop', 55), t(2, 900, 'Jazz', 11)], HOT);
    pool.served = [servedCtx('Rock', 77, 10)];
    assert.equal(M.reRankAndServe(USER, pool).id, 2);
  });
});

describe('starvation', () => {
  it('a repeatedly-skipped track eventually outranks the momentum tilt', () => {
    const pool = poolWith([t(1, 900, 'Jazz', 11), t(2, 132, 'Pop', 55)], HOT);
    pool.tracks[0].passedOver = 6;
    assert.equal(M.reRankAndServe(USER, pool).id, 1);
  });
});

describe('anchoring at the serve layer', () => {
  it('does not displace a clearly better-placed track', () => {
    const pool = poolWith([t(1, 900, 'Jazz', 11), t(2, 132, 'Pop', 55)], M.momentumFrom(hotPop(8), NOW));
    pool.tracks[0].passedOver = 3;
    assert.equal(M.reRankAndServe(USER, pool).id, 1);
  });
});

describe('degenerate pools', () => {
  it('serves the only track when the pool holds one', () => {
    const pool = poolWith([t(1, 132, 'Pop', 55)], HOT);
    assert.equal(M.reRankAndServe(USER, pool).id, 1);
  });

  it('still serves something when every candidate is genre-capped', () => {
    const pool = poolWith([t(1, 132, 'Pop', 55), t(2, 132, 'Pop', 56)], HOT);
    pool.served = ['Pop', 'Pop'];
    const served = M.reRankAndServe(USER, pool);
    assert.ok(served, 'must never stall the deck');
    assert.equal(pool.tracks.length, 1);
  });
});
