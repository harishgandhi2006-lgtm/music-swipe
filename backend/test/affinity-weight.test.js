import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __test_affinity as A } from '../services/recommender.js';
import { affinityScore } from '../db.js';

const row = (name, likes, rejects) =>
  ({ genre_name: name, genre_id: name, likes, rejects, score: affinityScore(likes, rejects) });

// The exact case that motivated this: demo_maya's real profile, where three
// single-swipe genres outscored a 28-like favourite and a 16-like runner-up.
const REAL_PROFILE = [
  row('Asian Music', 2, 0),
  row('Jazz', 1, 0),
  row('Metal', 1, 0),
  row('Folk', 1, 0),
  row('Pop', 28, 17),
  row('Alternative', 16, 11),
];

describe('affinityWeight tempers rate with evidence', () => {
  it('ranks a 28-like genre above a single-swipe one', () => {
    assert.ok(A.affinityWeight(row('Pop', 28, 17)) > A.affinityWeight(row('Jazz', 1, 0)));
  });

  it('which raw score alone got backwards', () => {
    // Documents the regression this fixes: by score, Jazz beat Pop.
    assert.ok(affinityScore(1, 0) > affinityScore(28, 17));
  });

  it('keeps volume sublinear rather than dominant', () => {
    // 28 likes is worth ~4.9x one like, not 28x.
    const ratio = Math.log1p(28) / Math.log1p(1);
    assert.ok(ratio > 4 && ratio < 6, `ratio was ${ratio}`);
  });

  it('still prefers the better rate at equal volume', () => {
    assert.ok(A.affinityWeight(row('A', 10, 1)) > A.affinityWeight(row('B', 10, 8)));
  });

  it('is zero for a row with no likes', () => {
    assert.equal(A.affinityWeight(row('None', 0, 3)), 0);
  });
});

describe('the established favourites are no longer squeezed out', () => {
  const ranked = [...REAL_PROFILE]
    .sort((a, b) => A.affinityWeight(b) - A.affinityWeight(a))
    .map(r => r.genre_name);

  it('puts the 28-like genre first', () => assert.equal(ranked[0], 'Pop'));
  it('puts the 16-like genre second', () => assert.equal(ranked[1], 'Alternative'));

  it('keeps both inside the sampled top five', () => {
    const top5 = ranked.slice(0, A.AFFINITY_TOP_N);
    assert.ok(top5.includes('Pop'));
    assert.ok(top5.includes('Alternative'));
  });

  it('demotes single-swipe genres without removing them', () => {
    assert.ok(ranked.indexOf('Jazz') > ranked.indexOf('Alternative'));
    assert.ok(ranked.includes('Jazz'));
  });

  it('ordered by raw score, Alternative would have been cut', () => {
    // The pre-fix behaviour, kept as a guard against regressing to it.
    const byScore = [...REAL_PROFILE].sort((a, b) => b.score - a.score).map(r => r.genre_name);
    assert.equal(byScore.slice(0, 5).includes('Alternative'), false);
  });
});

describe('sampleByAffinity', () => {
  it('returns null for an empty candidate list', () =>
    assert.equal(A.sampleByAffinity([]), null));

  it('returns null when every candidate has zero weight', () =>
    assert.equal(A.sampleByAffinity([row('None', 0, 5)]), null));

  it('always returns one of the supplied rows', () => {
    const names = new Set(REAL_PROFILE.map(r => r.genre_name));
    for (let i = 0; i < 200; i++) {
      const got = A.sampleByAffinity(REAL_PROFILE);
      assert.ok(got && names.has(got.genre_name));
    }
  });

  it('never samples outside the top N', () => {
    const ranked = [...REAL_PROFILE].sort((a, b) => A.affinityWeight(b) - A.affinityWeight(a));
    const eligible = new Set(ranked.slice(0, A.AFFINITY_TOP_N).map(r => r.genre_name));
    for (let i = 0; i < 200; i++) {
      assert.ok(eligible.has(A.sampleByAffinity(REAL_PROFILE).genre_name));
    }
  });

  it('favours the strongest candidate over many draws', () => {
    const counts = new Map();
    for (let i = 0; i < 2000; i++) {
      const name = A.sampleByAffinity(REAL_PROFILE).genre_name;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(top, 'Pop');
  });

  it('still gives weaker candidates a real share', () => {
    // Proportional sampling, not winner-take-all: exploration depends on it.
    const counts = new Map();
    for (let i = 0; i < 2000; i++) {
      const name = A.sampleByAffinity(REAL_PROFILE).genre_name;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    assert.ok((counts.get('Pop') || 0) < 2000, 'must not be winner-take-all');
    assert.ok(counts.size > 1, 'more than one genre should be reachable');
  });

  it('honours an explicit limit', () => {
    const ranked = [...REAL_PROFILE].sort((a, b) => A.affinityWeight(b) - A.affinityWeight(a));
    for (let i = 0; i < 100; i++) {
      assert.equal(A.sampleByAffinity(REAL_PROFILE, 1).genre_name, ranked[0].genre_name);
    }
  });
});
