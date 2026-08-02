import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __test_desirability as D } from '../services/recommender.js';

const near = (got, want, tol = 0.005) =>
  assert.ok(Number.isFinite(got) && Math.abs(got - want) <= tol,
    `expected ~${want}, got ${got}`);

const POPULAR = 900_000;  // p0 ≈ 0.588
const OBSCURE = 50_000;   // p0 ≈ 0.348

describe('rank-derived prior', () => {
  it('log-compresses a popular rank', () => near(D.popAbs(POPULAR), 0.959));
  it('derives the prior for a popular track', () => near(D.priorFor(POPULAR), 0.588));
  it('log-compresses an obscure rank', () => near(D.popAbs(OBSCURE), 0.161));
  it('derives the prior for an obscure track', () => near(D.priorFor(OBSCURE), 0.348));
  it('falls back to the base rate when rank is missing',
    () => near(D.priorFor(undefined), D.BASE_RATE));
});

// desirabilityScore is deliberately just the rank-derived prior: no aggregate
// of this app's own users' swipes is allowed to feed it (see
// .claude/skills/strict-isolation/SKILL.md), so it carries no separate
// evidence-shrinkage or uncertainty-bonus behaviour to test.
describe('desirabilityScore is exactly the prior', () => {
  it('matches priorFor for a popular track', () => near(D.desirabilityScore(POPULAR), D.priorFor(POPULAR)));
  it('matches priorFor for an obscure track', () => near(D.desirabilityScore(OBSCURE), D.priorFor(OBSCURE)));
});

describe('robustness', () => {
  for (const rank of [undefined, null, NaN, -5, 0, 1e9, 'abc']) {
    it(`stays finite and in [0,1] for rank=${String(rank)}`, () => {
      const v = D.desirabilityScore(rank);
      assert.ok(Number.isFinite(v), `not finite: ${v}`);
      assert.ok(v >= 0 && v <= 1, `out of range: ${v}`);
    });
  }
});

describe('within-batch percentile de-saturates rank', () => {
  // A realistic chart page: every rank bunched against the ceiling.
  const chart = [
    { id: 1, rank: 999_000 }, { id: 2, rank: 985_000 }, { id: 3, rank: 970_000 },
    { id: 4, rank: 955_000 }, { id: 5, rank: 940_000 },
  ];
  const rankOf = (t) => D.rawRank(t, null);

  it('spreads a saturated batch across the full range', () => {
    const pctOf = D.popPercentiles(chart, rankOf);
    const vals = chart.map(t => pctOf(t.id));
    assert.equal(Math.min(...vals), 0);
    assert.equal(Math.max(...vals), 1);
  });

  it('scores a candidate with no rank as neutral, not zero', () => {
    const pctOf = D.popPercentiles([{ id: 9, rank: undefined }, ...chart], rankOf);
    assert.equal(pctOf(9), 0.5);
  });

  // Regression: tied ranks used to receive 0.0/0.5/1.0 purely by array
  // position, inventing a score gap out of arrival order alone.
  it('gives tied ranks identical percentiles', () => {
    const tied = [{ id: 1, rank: 500 }, { id: 2, rank: 500 }, { id: 3, rank: 500 }];
    const pctOf = D.popPercentiles(tied, rankOf);
    assert.equal(pctOf(1), 0.5);
    assert.equal(pctOf(2), 0.5);
    assert.equal(pctOf(3), 0.5);
  });

  it('is independent of input order', () => {
    const items = [{ id: 1, rank: 100 }, { id: 2, rank: 500 }, { id: 3, rank: 900 }];
    const a = D.popPercentiles(items, rankOf);
    const b = D.popPercentiles([...items].reverse(), rankOf);
    for (const { id } of items) assert.equal(a(id), b(id));
  });
});
