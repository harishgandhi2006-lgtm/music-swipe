import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import db, { affinityScore } from '../db.js';

const near = (got, want, tol = 0.0005) =>
  assert.ok(Math.abs(got - want) <= tol, `expected ~${want}, got ${got}`);

// The prior the recommender falls back to for an unseen genre or artist.
const UNKNOWN_PRIOR = 0.5;
const MIN_GENRE_SCORE = 0.5;   // must track recommender.js
const MIN_ARTIST_SCORE = 0.55;

describe('affinityScore — symmetric Laplace', () => {
  it('puts no evidence exactly at the prior', () => near(affinityScore(0, 0), 0.5));
  it('scores one like at 2/3', () => near(affinityScore(1, 0), 0.667));
  it('scores one like against one reject back at neutral', () => near(affinityScore(1, 1), 0.5));
  it('scores a lone reject at 1/3', () => near(affinityScore(0, 1), 0.333));
  it('scores two clean likes at 3/4', () => near(affinityScore(2, 0), 0.75));
  it('scores two likes against one reject at 3/5', () => near(affinityScore(2, 1), 0.6));
});

describe('calibration against the unknown prior — the reason for the change', () => {
  // Under the old likes/(likes+rejects+1), a single like scored exactly 0.5 —
  // no better than never having been seen — and one like against one reject
  // scored 0.333, i.e. worse than silence.
  it('a single like now beats an unseen genre', () =>
    assert.ok(affinityScore(1, 0) > UNKNOWN_PRIOR));

  it('a single reject now loses to an unseen genre', () =>
    assert.ok(affinityScore(0, 1) < UNKNOWN_PRIOR));

  it('evenly mixed evidence lands back at the prior', () =>
    assert.equal(affinityScore(3, 3), UNKNOWN_PRIOR));

  it('the crossover is exactly likes === rejects', () => {
    for (const n of [1, 2, 5, 20]) {
      assert.equal(affinityScore(n, n), UNKNOWN_PRIOR, `${n}L/${n}R should be neutral`);
      assert.ok(affinityScore(n + 1, n) > UNKNOWN_PRIOR);
      assert.ok(affinityScore(n, n + 1) < UNKNOWN_PRIOR);
    }
  });
});

describe('monotonicity and bounds', () => {
  it('rises with likes', () =>
    assert.ok(affinityScore(5, 2) > affinityScore(4, 2)));

  it('falls with rejects', () =>
    assert.ok(affinityScore(4, 3) < affinityScore(4, 2)));

  it('stays strictly inside (0,1)', () => {
    for (const [l, r] of [[0, 0], [0, 100], [100, 0], [50, 50], [1, 999]]) {
      const s = affinityScore(l, r);
      assert.ok(s > 0 && s < 1, `${l}L/${r}R gave ${s}`);
    }
  });

  it('approaches but never reaches 1 on a long clean run', () => {
    assert.ok(affinityScore(500, 0) > 0.99);
    assert.ok(affinityScore(500, 0) < 1);
  });
});

describe('thresholds admit and reject the right rows', () => {
  const passesGenre = (l, r) => affinityScore(l, r) > MIN_GENRE_SCORE;
  const passesArtist = (l, r) => affinityScore(l, r) > MIN_ARTIST_SCORE;

  it('admits a genre liked more than rejected', () => assert.ok(passesGenre(2, 1)));
  it('excludes a genre with balanced evidence', () => assert.equal(passesGenre(1, 1), false));
  it('excludes a genre rejected more than liked', () => assert.equal(passesGenre(1, 2), false));

  it('holds artists to a stricter bar than genres', () => {
    // 5L/4R clears the genre bar but not the artist bar.
    assert.ok(passesGenre(5, 4));
    assert.equal(passesArtist(5, 4), false);
  });

  it('admits a clearly favoured artist', () => assert.ok(passesArtist(3, 1)));
});

describe('stored scores stay in step with the formula', () => {
  const USER = '__affinity_test__';

  before(() => {
    db.upsertGenreScore(USER, 900, 'TestGenre', 3, 1);
    db.upsertArtistScore(USER, 900, 'TestArtist', 3, 1);
  });

  it('writes the smoothed score for a genre', () =>
    near(db.getGenreScore(USER, 900), affinityScore(3, 1)));

  it('writes the smoothed score for an artist', () =>
    near(db.getArtistScore(USER, 900), affinityScore(3, 1)));

  it('surfaces a favoured genre through getTopGenres', () => {
    const top = db.getTopGenres(USER, MIN_GENRE_SCORE, 5);
    assert.ok(top.some(g => g.genre_id === 900));
  });

  it('drops a genre once rejects overtake likes', () => {
    db.upsertGenreScore(USER, 901, 'Disliked', 1, 4);
    const top = db.getTopGenres(USER, MIN_GENRE_SCORE, 5);
    assert.equal(top.some(g => g.genre_id === 901), false);
  });

  it('never surfaces a row with zero likes, whatever the score', () => {
    db.upsertGenreScore(USER, 902, 'Untouched', 0, 0); // scores exactly 0.5
    const top = db.getTopGenres(USER, 0, 10);
    assert.equal(top.some(g => g.genre_id === 902), false);
  });
});
