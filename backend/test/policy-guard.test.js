import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { __test_weights as WEIGHTS } from '../services/recommender.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('policy guard: the core scoring formula stays individual-input-only', () => {
  it('carries no social/collaborative-filtering term', () => {
    assert.equal('social' in WEIGHTS, false);
    assert.equal('friend' in WEIGHTS, false);
    assert.equal('neighbor' in WEIGHTS, false);
  });

  it('is exactly the five individual signals, summing to 1', () => {
    assert.deepEqual(
      Object.keys(WEIGHTS).sort(),
      ['artist', 'desirability', 'duration', 'genre', 'popularity'].sort(),
    );
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights should sum to 1, got ${sum}`);
  });

  it('never calls db.insertInteraction from within the recommender itself', () => {
    const source = readFileSync(join(__dirname, '../services/recommender.js'), 'utf8');
    // Checks for an actual call, not the word appearing in a comment.
    assert.equal(/\.insertInteraction\s*\(/.test(source), false);
  });

  it('carries no friendship/friend-graph reference', () => {
    const source = readFileSync(join(__dirname, '../services/recommender.js'), 'utf8');
    assert.equal(/friendship/i.test(source), false);
  });

  it('carries no cross-user crowd-stat table reference', () => {
    const source = readFileSync(join(__dirname, '../services/recommender.js'), 'utf8');
    assert.equal(/track_stats|getTrackStats|recomputeTrackStats/.test(source), false);
  });
});
