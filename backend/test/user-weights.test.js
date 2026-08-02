import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import db from '../db.js';
import {
  __test_weights as WEIGHTS,
  effectiveWeights,
  effectiveEpsilon,
} from '../services/recommender.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWN_KEYS = ['artist', 'desirability', 'duration', 'genre', 'popularity'].sort();
const sum = (w) => Object.values(w).reduce((a, b) => a + b, 0);

describe('effectiveWeights — per-user override never breaks the policy shape', () => {
  it('returns the exact global default, by identity, when there is no override', () => {
    assert.equal(effectiveWeights(null), WEIGHTS);
  });

  it('returns the default values when the row exists but every field is null', () => {
    const w = effectiveWeights({ genre_weight: null, artist_weight: null, exploration_rate: null });
    assert.deepEqual(Object.keys(w).sort(), KNOWN_KEYS);
    for (const key of KNOWN_KEYS) assert.ok(Math.abs(w[key] - WEIGHTS[key]) < 1e-9);
  });

  it('always yields exactly the five known keys, never a sixth', () => {
    const cases = [
      { genre_weight: 1, artist_weight: 1, exploration_rate: 0.5 },
      { genre_weight: 0, artist_weight: 0, exploration_rate: 0 },
      { genre_weight: 0.7, artist_weight: 0.1, exploration_rate: null },
      { genre_weight: -5, artist_weight: 99, exploration_rate: 1 }, // out-of-range input
    ];
    for (const prefs of cases) {
      assert.deepEqual(Object.keys(effectiveWeights(prefs)).sort(), KNOWN_KEYS);
    }
  });

  it('sums to 1, or to genre+artist when those two alone already exceed 1', () => {
    for (let i = 0; i < 200; i++) {
      const genre_weight = Math.random();
      const artist_weight = Math.random();
      const w = effectiveWeights({ genre_weight, artist_weight, exploration_rate: null });
      const expected = Math.max(1, genre_weight + artist_weight);
      assert.ok(Math.abs(sum(w) - expected) < 1e-9, `sum was ${sum(w)} for g=${genre_weight} a=${artist_weight}`);
    }
  });

  it('clamps out-of-range slider values into [0,1] rather than propagating them', () => {
    const w = effectiveWeights({ genre_weight: -5, artist_weight: 99, exploration_rate: null });
    assert.equal(w.genre, 0);
    assert.equal(w.artist, 1);
  });

  it('zeroes, not negates, the remaining three weights when genre+artist saturate the budget', () => {
    const w = effectiveWeights({ genre_weight: 0.7, artist_weight: 0.5, exploration_rate: null });
    assert.equal(w.duration, 0);
    assert.equal(w.popularity, 0);
    assert.equal(w.desirability, 0);
    assert.ok(Math.abs(sum(w) - 1.2) < 1e-9, 'genre+artist alone define the (over-budget) total here');
  });

  it('never mutates the global WEIGHTS object', () => {
    const before = JSON.stringify(WEIGHTS);
    effectiveWeights({ genre_weight: 1, artist_weight: 1, exploration_rate: 1 });
    effectiveWeights({ genre_weight: 0, artist_weight: 0, exploration_rate: 0 });
    assert.equal(JSON.stringify(WEIGHTS), before);
  });
});

describe('effectiveEpsilon', () => {
  it('falls back to the default when unset or absent', () => {
    const DEFAULT = effectiveEpsilon(null);
    assert.equal(effectiveEpsilon({ exploration_rate: null }), DEFAULT);
    assert.equal(effectiveEpsilon(undefined), DEFAULT);
  });

  it('uses the user value when set, including 0', () => {
    assert.equal(effectiveEpsilon({ exploration_rate: 0.5 }), 0.5);
    assert.equal(effectiveEpsilon({ exploration_rate: 0 }), 0);
  });
});

describe('effectiveWeights source stays a pure function (no DB access of its own)', () => {
  const source = readFileSync(join(__dirname, '../services/recommender.js'), 'utf8');
  const fnBody = source.slice(source.indexOf('export function effectiveWeights'), source.indexOf('export function effectiveEpsilon'));

  it('never calls into db.js from inside effectiveWeights', () => {
    assert.equal(/db\./.test(fnBody), false);
  });
});

describe('user_preferences table stays scoped per user (no cross-user bleed)', () => {
  it('one user setting preferences never affects another', () => {
    db.upsertUserPreferences('__pref_user_a__', { genre_weight: 0.9, artist_weight: 0.9, exploration_rate: 0.9 });
    assert.equal(db.getUserPreferences('__pref_user_b__'), null);

    const a = db.getUserPreferences('__pref_user_a__');
    assert.equal(a.genre_weight, 0.9);
  });

  it('a partial update leaves untouched fields at whatever was last written (not merged from defaults)', () => {
    db.upsertUserPreferences('__pref_user_c__', { genre_weight: 0.3, artist_weight: null, exploration_rate: null });
    const prefs = db.getUserPreferences('__pref_user_c__');
    assert.equal(prefs.genre_weight, 0.3);
    assert.equal(prefs.artist_weight, null);
  });
});

describe('policy guard extension: profile.js preferences route never takes a foreign userId', () => {
  const source = readFileSync(join(__dirname, '../routes/profile.js'), 'utf8');
  const preferencesSection = source.slice(source.indexOf("'/profile/preferences'"));

  it('only ever reads/writes db preferences scoped to req.userId', () => {
    assert.equal(/getUserPreferences\(\s*req\.userId/.test(preferencesSection), true);
    assert.equal(/upsertUserPreferences\(\s*req\.userId/.test(preferencesSection), true);
    // No call site in this section passes anything other than req.userId as
    // the user identifier — e.g. req.params.userId or req.body.userId.
    assert.equal(/(getUserPreferences|upsertUserPreferences)\(\s*req\.(params|body|query)\.\w*[Uu]ser/.test(preferencesSection), false);
  });
});
