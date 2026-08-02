import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __test_momentum as M } from '../services/recommender.js';

// The caps bound how often an artist recurs, not how close together. Two in a
// row sits inside MAX_SAME_ARTIST yet is the arrangement that reads as
// repetitive, so it gets a soft nudge instead of a ban.

const USER = '__adjacency_probe__'; // no rows, so affinity terms are neutral
const NOW = Date.now();

const t = (id, genre_id, genre_name, artist_id, via = 'exploit') => ({
  id, genre_id, genre_name, artist_id, album_id: id * 10,
  duration: 200, rank: 500_000, via,
});

const servedCtx = (genre, artistId, albumId) => ({ genre, family: null, artistId, albumId });

const poolWith = (tracks, served = []) => {
  const pool = M.makePool(tracks);
  pool.momentumCache = { at: NOW, value: M.EMPTY_MOMENTUM };
  pool.served = served;
  return pool;
};

const REPEAT_ARTIST = 55;

describe('soft adjacency penalty', () => {
  it('demotes a track by the artist just played', () => {
    // Head position would normally win on the FIFO bias alone.
    const pool = poolWith(
      [t(1, 900, 'Jazz', REPEAT_ARTIST), t(2, 901, 'Rock', 12)],
      [servedCtx('Jazz', REPEAT_ARTIST, 7777)],
    );
    assert.equal(M.reRankAndServe(USER, pool).id, 2);
  });

  it('leaves a different artist alone', () => {
    const pool = poolWith(
      [t(1, 900, 'Jazz', 11), t(2, 901, 'Rock', 12)],
      [servedCtx('Jazz', REPEAT_ARTIST, 7777)],
    );
    assert.equal(M.reRankAndServe(USER, pool).id, 1);
  });

  it('does nothing on the first serve of a session', () => {
    const pool = poolWith([t(1, 900, 'Jazz', REPEAT_ARTIST), t(2, 901, 'Rock', 12)], []);
    assert.equal(M.reRankAndServe(USER, pool).id, 1);
  });

  it('only considers the immediate neighbour, not the whole window', () => {
    // Same artist two serves back — recurrence is the caps' business, not this.
    const pool = poolWith(
      [t(1, 900, 'Jazz', REPEAT_ARTIST), t(2, 901, 'Rock', 12)],
      [servedCtx('Rock', REPEAT_ARTIST, 8888), servedCtx('Pop', 99, 9999)],
    );
    assert.equal(M.reRankAndServe(USER, pool).id, 1);
  });

  it('ignores a missing artist id rather than matching on it', () => {
    // normalizeTrack writes 0 for a missing artist; 0 must not match 0.
    const pool = poolWith(
      [t(1, 900, 'Jazz', 0), t(2, 901, 'Rock', 12)],
      [servedCtx('Jazz', 0, 7777)],
    );
    assert.equal(M.reRankAndServe(USER, pool).id, 1);
  });
});

describe('the penalty is soft, not a block', () => {
  it('is small enough for momentum to overcome', () => {
    // Max momentum swing is ~0.073 (see the anchoring guarantee).
    assert.ok(M.ADJACENT_ARTIST_PENALTY < 0.073,
      'a hot streak must still be able to surface a follow-up immediately');
  });

  it('exceeds the FIFO bias, or it would merely cancel it into a tie', () => {
    // At exactly STALE_W the head's positional advantage is neutralised rather
    // than overcome, and the stable sort hands the serve straight back to the
    // repeat — no effect in the position where adjacency matters most.
    assert.ok(M.ADJACENT_ARTIST_PENALTY > M.STALE_W);
  });

  it('is outweighed by a couple of skips', () => {
    assert.ok(M.ADJACENT_ARTIST_PENALTY < 2 * M.STARVE_W);
  });

  it('still serves the repeat artist when it is the only option', () => {
    const pool = poolWith([t(1, 900, 'Jazz', REPEAT_ARTIST)], [servedCtx('Jazz', REPEAT_ARTIST, 7777)]);
    const served = M.reRankAndServe(USER, pool);
    assert.ok(served, 'must never stall the deck');
    assert.equal(served.id, 1);
  });

  it('yields to a strong enough advantage — back-to-back can still happen', () => {
    // Starvation credit stands in for an overwhelming score advantage.
    const pool = poolWith(
      [t(1, 900, 'Jazz', REPEAT_ARTIST), t(2, 901, 'Rock', 12)],
      [servedCtx('Jazz', REPEAT_ARTIST, 7777)],
    );
    pool.tracks[0].passedOver = 4; // 4 * STARVE_W = 0.16, well past the penalty
    assert.equal(M.reRankAndServe(USER, pool).id, 1);
  });

  it('does not turn adjacency into a served-window breach', () => {
    // The penalty is a scoring nudge only; it must not start blocking serves.
    const pool = poolWith(
      [t(1, 900, 'Jazz', REPEAT_ARTIST)],
      [servedCtx('Jazz', REPEAT_ARTIST, 7777)],
    );
    assert.equal(M.violatesServed(pool, pool.tracks[0]), false);
  });
});

describe('adjacency interacts correctly with the other guards', () => {
  it('does not override the forced-discovery floor', () => {
    const pool = poolWith(
      [t(1, 900, 'Jazz', 11), t(2, 901, 'Rock', REPEAT_ARTIST, 'explore')],
      [servedCtx('Rock', REPEAT_ARTIST, 7777)],
    );
    pool.sinceExploreServed = 4;
    assert.equal(M.reRankAndServe(USER, pool).via, 'explore');
  });

  it('never produces a non-finite score', () => {
    const pool = poolWith(
      [t(1, 900, 'Jazz', REPEAT_ARTIST), t(2, 901, 'Rock', 12)],
      [servedCtx('Jazz', REPEAT_ARTIST, 7777)],
    );
    const served = M.reRankAndServe(USER, pool);
    assert.ok(served && Number.isFinite(served.id));
  });
});
