import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __test_fatigue as F, __test_diversity as D } from '../services/recommender.js';

// Normalized-track shape, as noteQueued receives it.
const track = (artist_id, album_id, genre_name) => ({ artist_id, album_id, genre_name });
// Raw Deezer candidate shape, as pickBest scores it.
const cand = (artistId, albumId, genre) =>
  F.candidateOf({ artist: { id: artistId }, album: { id: albumId } }, genre);

const capped = (pool, c) => F.fatigueOf(pool, c).overCap;

describe('artist cap (2 per 10)', () => {
  it('allows the first', () => {
    const p = F.newPool();
    assert.equal(capped(p, cand(1, 10, 'Pop')), false);
  });

  it('allows the second', () => {
    const p = F.newPool();
    F.noteQueued(p, track(1, 10, 'Pop'));
    assert.equal(capped(p, cand(1, 11, 'Rock')), false);
  });

  it('blocks the third', () => {
    const p = F.newPool();
    F.noteQueued(p, track(1, 10, 'Pop'));
    F.noteQueued(p, track(1, 11, 'Rock'));
    assert.equal(capped(p, cand(1, 12, 'Jazz')), true);
  });

  it('leaves other artists unaffected', () => {
    const p = F.newPool();
    F.noteQueued(p, track(1, 10, 'Pop'));
    F.noteQueued(p, track(1, 11, 'Rock'));
    assert.equal(capped(p, cand(99, 12, 'Jazz')), false);
  });
});

describe('album cap (1 per 10)', () => {
  it('blocks a second cut from the same album', () => {
    const p = F.newPool();
    F.noteQueued(p, track(1, 500, 'Pop'));
    assert.equal(capped(p, cand(2, 500, 'Rock')), true);
  });

  it('allows a different album', () => {
    const p = F.newPool();
    F.noteQueued(p, track(1, 500, 'Pop'));
    assert.equal(capped(p, cand(2, 501, 'Rock')), false);
  });
});

describe('genre cap (2 per 5) — semantics unchanged', () => {
  const twoPop = () => {
    const p = F.newPool();
    F.noteQueued(p, track(1, 1, 'Pop'));
    F.noteQueued(p, track(2, 2, 'Pop'));
    return p;
  };

  it('blocks a third of the same genre', () => {
    assert.equal(capped(twoPop(), cand(3, 3, 'Pop')), true);
  });

  it('agrees with the legacy violatesDiversity guard', () => {
    assert.equal(D.violatesDiversity(twoPop(), { genre_name: 'Pop' }), true);
  });

  it('allows the genre again once it leaves the 5-wide window', () => {
    const p = twoPop();
    for (let i = 0; i < 5; i++) F.noteQueued(p, track(10 + i, 100 + i, 'Jazz'));
    assert.equal(capped(p, cand(3, 3, 'Pop')), false);
  });
});

describe('unknown genre must not mass-cap', () => {
  // Raw candidates carry no genre until the /album enrichment call. Bucketing
  // those as "Unknown" would let two unlabeled tracks in the window cap nearly
  // every uncached candidate at once — which is most of them.
  const twoUnlabeled = () => {
    const p = F.newPool();
    F.noteQueued(p, track(1, 1, null));
    F.noteQueued(p, track(2, 2, null));
    return p;
  };

  it('leaves a candidate of unknown genre uncapped', () => {
    assert.equal(capped(twoUnlabeled(), cand(50, 50, null)), false);
  });

  it('still buckets unlabeled tracks for the post-fetch guard', () => {
    assert.equal(D.violatesDiversity(twoUnlabeled(), { genre_name: null }), true);
  });
});

describe('family cap (4 per 10) closes the string-equality hole', () => {
  // "Rap/Hip Hop", "Hip Hop" and "Rap" are distinct strings, so each can sit at
  // 2 under exact matching and yield 4-of-5 same-flavour tracks unnoticed.
  const fourUrban = () => {
    const p = F.newPool();
    F.noteQueued(p, track(1, 1, 'Rap/Hip Hop'));
    F.noteQueued(p, track(2, 2, 'Hip Hop'));
    F.noteQueued(p, track(3, 3, 'Rap'));
    F.noteQueued(p, track(4, 4, 'Soul'));
    return p;
  };

  it('blocks a fifth track from the same family', () => {
    assert.equal(capped(fourUrban(), cand(5, 5, 'Funk')), true);
  });

  it('even though every individual genre is under its own cap', () => {
    assert.ok(F.genreRunLength(fourUrban(), 'Rap/Hip Hop') < F.MAX_SAME_GENRE);
  });
});

describe('graded penalty', () => {
  it('leaves a clean candidate untouched', () => {
    assert.equal(F.fatigueOf(F.newPool(), cand(1, 10, 'Pop')).multiplier, 1);
  });

  it('compounds across dimensions', () => {
    const p = F.newPool();
    F.noteQueued(p, track(1, 10, 'Pop'));
    // 1 artist + 1 album + 1 genre + half-weighted family
    assert.ok(Math.abs(F.fatigueOf(p, cand(1, 10, 'Pop')).multiplier
      - Math.pow(F.FATIGUE_DECAY, 3.5)) < 0.001);
  });

  it('applies the decay once for a single repeat', () => {
    const p = F.newPool();
    F.noteQueued(p, track(1, 99, 'Jazz'));
    assert.ok(Math.abs(F.fatigueOf(p, cand(1, 77, 'Rock')).multiplier - F.FATIGUE_DECAY) < 0.001);
  });

  it('never reaches zero, so a total order always exists', () => {
    const p = F.newPool();
    for (let i = 0; i < F.FATIGUE_WINDOW; i++) F.noteQueued(p, track(1, 1, 'Pop'));
    assert.ok(F.fatigueOf(p, cand(1, 1, 'Pop')).multiplier > 0);
  });
});

describe('ring buffer bookkeeping', () => {
  const filled = () => {
    const p = F.newPool();
    for (let i = 0; i < 25; i++) F.noteQueued(p, track(i + 1, i + 1, `G${i}`));
    return p;
  };

  it('caps the window length', () => {
    assert.equal(filled().recent.length, F.FATIGUE_WINDOW);
  });

  it('prunes counts alongside the window', () => {
    assert.equal(filled().counts.artist.size, F.FATIGUE_WINDOW);
  });

  it('deletes evicted keys rather than leaving zero entries', () => {
    const p = filled();
    for (const v of p.counts.artist.values()) assert.ok(v > 0);
  });

  it('keeps incremental counts equal to a full recount', () => {
    const p = filled();
    const recount = new Map();
    for (const r of p.recent) recount.set(r.artistId, (recount.get(r.artistId) || 0) + 1);
    assert.deepEqual([...p.counts.artist].sort(), [...recount].sort());
  });
});

describe('missing ids are never counted', () => {
  // normalizeTrack writes 0 for a missing artist/album rather than null.
  const withBlanks = () => {
    const p = F.newPool();
    F.noteQueued(p, track(0, 0, 'Pop'));
    F.noteQueued(p, track(null, null, 'Pop'));
    return p;
  };

  it('ignores artist id 0', () => assert.equal(withBlanks().counts.artist.has(0), false));
  it('ignores a null artist', () => assert.equal(withBlanks().counts.artist.has(null), false));

  it('still scores a candidate that has no ids at all', () => {
    assert.ok(F.fatigueOf(withBlanks(), F.candidateOf({}, 'Rock')).multiplier > 0);
  });
});
