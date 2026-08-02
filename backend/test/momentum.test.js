import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __test_momentum as M } from '../services/recommender.js';

const NOW = 1_800_000_000_000;
// getSessionSwipes returns newest-first; these fixtures match that.
const swipe = (action, genre_id, genre_name, artist_id, agoMs = 0) =>
  ({ action, genre_id, genre_name, artist_id, created_at: NOW - agoMs });
const track = (genre_id, genre_name, artist_id) => ({ genre_id, genre_name, artist_id });

const hotPop = (n, agoMs = 0) =>
  Array.from({ length: n }, () => swipe('like', 132, 'Pop', 55, agoMs));
const POP = track(132, 'Pop', 55);

const near = (got, want, tol = 0.005) =>
  assert.ok(Math.abs(got - want) <= tol, `expected ~${want}, got ${got}`);

describe('empty and cold sessions are exactly neutral', () => {
  it('genre multiplier is exactly 1', () =>
    assert.equal(M.multGenre(M.EMPTY_MOMENTUM, POP), 1));
  it('artist multiplier is exactly 1', () =>
    assert.equal(M.multArtist(M.EMPTY_MOMENTUM, POP), 1));
  it('no rows yields no influence', () =>
    assert.equal(M.momentumFrom([], NOW).beta.genre, 0));
});

describe('a hot streak tilts, within bounds', () => {
  const m = () => M.momentumFrom(hotPop(4), NOW);

  it('lifts the streak genre', () => assert.ok(M.multGenre(m(), POP) > 1));
  it('never exceeds the genre bound', () =>
    assert.ok(M.multGenre(m(), POP) <= 1 + M.BETA_GENRE + 1e-9));
  it('never exceeds the artist bound', () =>
    assert.ok(M.multArtist(m(), POP) <= 1 + M.BETA_ARTIST + 1e-9));
  it('leaves an unrelated genre untouched', () =>
    assert.equal(M.multGenre(m(), track(999, 'Jazz', 3)), 1));
});

describe('anchoring guarantee — the load-bearing property', () => {
  const m = M.momentumFrom(hotPop(6), NOW);
  const W = { genre: 0.26, artist: 0.26 }; // must track WEIGHTS in recommender.js
  // Largest possible change to a final score: affinity terms at their ceiling.
  const delta = W.genre * (M.multGenre(m, POP) - 1) + W.artist * (M.multArtist(m, POP) - 1);

  it('caps the total score swing at ~0.073', () => near(delta, 0.073, 0.001));

  it('so tracks more than 0.146 apart can never swap order', () =>
    assert.ok(2 * delta <= 0.1461));

  it('a better-anchored track still wins under maximal momentum', () => {
    const cold = track(999, 'Jazz', 3);
    const hotScore = 0.40 * M.multGenre(m, POP) * M.multArtist(m, POP);
    const coldScore = 0.60 * M.multGenre(m, cold) * M.multArtist(m, cold);
    assert.ok(coldScore > hotScore, `${coldScore} should beat ${hotScore}`);
  });
});

describe('reject asymmetry', () => {
  const up = M.multGenre(M.momentumFrom(Array.from({ length: 3 },
    () => swipe('like', 1, 'Pop', 9)), NOW), track(1, 'Pop', 9));
  const down = M.multGenre(M.momentumFrom(Array.from({ length: 3 },
    () => swipe('reject', 1, 'Pop', 9)), NOW), track(1, 'Pop', 9));

  it('likes push up', () => assert.ok(up > 1));
  it('rejects push down', () => assert.ok(down < 1));
  // A reject is overloaded — wrong mood, already knows it, bored thumb — so it
  // steers with less authority than a like.
  it('a reject moves less than a like', () => assert.ok((up - 1) > (1 - down)));
});

describe('temporal decay', () => {
  it('a fresh streak is active', () =>
    assert.ok(M.multGenre(M.momentumFrom(hotPop(4, 0), NOW), POP) > 1));

  it('a ten-minute pause collapses momentum to neutral', () =>
    assert.equal(M.multGenre(M.momentumFrom(hotPop(4, 10 * 60_000), NOW), POP), 1));
});

describe('self-dilution as a session diversifies', () => {
  const focused = M.momentumFrom(hotPop(2), NOW);
  const diluted = M.momentumFrom([
    ...hotPop(2),
    ...Array.from({ length: 10 }, (_, i) => swipe('like', 20 + i, 'Jazz', 30 + i)),
  ], NOW);

  it('the same two likes read weaker among varied swipes', () =>
    assert.ok(M.multGenre(diluted, POP) < M.multGenre(focused, POP)));
});

describe('thrash: alternating swipes must not oscillate the deck', () => {
  // A like/reject pair nets +0.4 by design, so alternating on one genre reads as
  // weak-positive engagement rather than zero. What must not happen is the
  // served order churning between consecutive requests.
  const mults = [];
  const seq = [];
  for (let n = 1; n <= 8; n++) {
    seq.unshift(swipe(n % 2 ? 'like' : 'reject', 1, 'Pop', 9));
    mults.push(M.multGenre(M.momentumFrom(seq, NOW), track(1, 'Pop', 9)));
  }
  const spread = Math.max(...mults) - Math.min(...mults);

  it('stays weak-positive, never negative', () => assert.ok(mults.every(x => x >= 1)));
  it('never exceeds the bound', () =>
    assert.ok(mults.every(x => x <= 1 + M.BETA_GENRE + 1e-9)));

  it('the FIFO bias dominates the wobble, so serve order stays stable', () => {
    const STALE_W = 0.05, W_GENRE = 0.26; // must track reRankAndServe
    assert.ok(W_GENRE * spread < STALE_W,
      `wobble ${(W_GENRE * spread).toFixed(4)} should stay under ${STALE_W}`);
  });

  it('the deadband zeroes small signals', () => assert.equal(M.deadband(0.1), 0));
  it('the deadband passes real signals', () => assert.equal(M.deadband(0.5), 0.5));
});

describe('family spillover at half strength', () => {
  const m = M.momentumFrom(Array.from({ length: 4 },
    () => swipe('like', 116, 'Rap/Hip Hop', 9)), NOW);
  const direct = M.multGenre(m, track(116, 'Rap/Hip Hop', 9));
  const cousin = M.multGenre(m, track(555, 'Soul', 77));      // same family
  const alien = M.multGenre(m, track(777, 'Classical', 88));  // different family

  it('lifts a neighbouring genre', () => assert.ok(cousin > 1));
  it('but less than the direct signal', () => assert.ok(cousin < direct));
  it('leaves an unrelated family alone', () => assert.equal(alien, 1));
});

describe('session-length softening hands off to the long-term profile', () => {
  const short = M.momentumFrom(hotPop(10), NOW).beta.genre;
  const long = M.momentumFrom(hotPop(40), NOW).beta.genre;

  it('beta shrinks as the session lengthens', () => assert.ok(long < short));
  it('but never goes negative', () => assert.ok(long > 0));
});

describe('robustness against malformed rows', () => {
  const weird = M.momentumFrom([
    { action: 'like', genre_id: null, genre_name: null, artist_id: null, created_at: NOW },
    { action: 'reject', genre_id: undefined, genre_name: undefined, artist_id: 0, created_at: NOW },
    { action: 'like', genre_id: 5, genre_name: 'Pop', artist_id: 3, created_at: NOW + 999_999 },
  ], NOW);
  const probe = track(5, 'Pop', 3);

  it('yields a finite genre multiplier', () =>
    assert.ok(Number.isFinite(M.multGenre(weird, probe))));
  it('yields a finite artist multiplier', () =>
    assert.ok(Number.isFinite(M.multArtist(weird, probe))));
  it('never keys artist id 0', () => assert.equal(weird.artist.has(0), false));
  it('never keys a null genre', () => assert.equal(weird.genre.has(null), false));
  it('stays inside the bound even with a future timestamp', () => {
    const g = M.multGenre(weird, probe);
    assert.ok(g <= 1 + M.BETA_GENRE + 1e-9 && g >= 1 - M.BETA_GENRE - 1e-9);
  });
});
