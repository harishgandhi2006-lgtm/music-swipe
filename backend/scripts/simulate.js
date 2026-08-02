/**
 * Offline recommendation simulator — zero Deezer calls, zero real data.
 *
 *   npm run simulate            all scenarios
 *   npm run simulate -- --scenario=hot-streak --swipes=200
 *
 * Why this exists: scoring changes fail silently, and the failure that matters
 * most — a feed collapsing into one genre, or the exploration rate quietly
 * being starved — only emerges over ~100 swipes. That is impractical to check
 * by hand against a rate-limited API, and invisible to unit tests, which see
 * one decision at a time rather than the shape of a whole session.
 *
 * What it does and does not cover: the serve layer is the real code path
 * (reRankAndServe, momentum, the caps). Candidate *sourcing* is synthetic —
 * strategies need Deezer — so the pool is topped up from a fake catalogue,
 * filtered through the same fatigue admission rule pickBest applies. Genre
 * distribution therefore reflects the catalogue, not Deezer; the run lengths,
 * exploration rate and momentum trajectory are the meaningful outputs.
 */
import {
  __test_momentum as M,
  __test_fatigue as F,
} from '../services/recommender.js';

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};

const USER = '__simulator__';           // no DB rows, so affinity terms stay neutral
const POOL_TARGET = 12;
const EPSILON = 0.20;                   // must track recommender.js
const EXPLORE_EVERY = 4;

// ── Synthetic catalogue ───────────────────────────────────────────────────────
// Deliberately lopsided: Pop is over-represented, so a bubble has every chance
// to form if the guards don't hold.
const GENRES = [
  { id: 132, name: 'Pop', weight: 5 },
  { id: 116, name: 'Rap/Hip Hop', weight: 3 },
  { id: 152, name: 'Rock', weight: 3 },
  { id: 165, name: 'R&B', weight: 2 },
  { id: 129, name: 'Jazz', weight: 1 },
  { id: 106, name: 'Electro', weight: 2 },
  { id: 466, name: 'Folk', weight: 1 },
];

const ARTISTS_PER_GENRE = Number(arg('artists', 10));
const ALBUMS_PER_ARTIST = Number(arg('albums', 3));

// Deterministic PRNG so runs are reproducible and comparable.
let seed = Number(arg('seed', 42));
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const weightedGenre = () => {
  const total = GENRES.reduce((s, g) => s + g.weight, 0);
  let r = rnd() * total;
  for (const g of GENRES) { r -= g.weight; if (r <= 0) return g; }
  return GENRES[GENRES.length - 1];
};

let nextId = 1;
function makeTrack() {
  const g = weightedGenre();
  // Deliberately narrower than real Deezer results, so burnout is reachable and
  // the caps are genuinely under pressure.
  const artistId = g.id * 100 + Math.floor(rnd() * ARTISTS_PER_GENRE);
  return {
    id: nextId++,
    genre_id: g.id, genre_name: g.name,
    artist_id: artistId,
    album_id: artistId * 10 + Math.floor(rnd() * ALBUMS_PER_ARTIST),
    duration: 180 + Math.floor(rnd() * 120),
    rank: Math.floor(rnd() * 1_000_000),
    via: rnd() < EPSILON ? 'explore' : 'exploit',
  };
}

// Mirrors pickBest's admission rule: hard caps first, relaxation if that would
// leave nothing at all.
function topUp(pool) {
  let guard = 0;
  while (pool.tracks.length < POOL_TARGET && guard++ < 200) {
    const batch = Array.from({ length: 8 }, makeTrack);
    const uncapped = batch.filter(t => !F.fatigueOf(pool, F.candidateOf(
      { artist: { id: t.artist_id }, album: { id: t.album_id } }, t.genre_name)).overCap);
    const working = uncapped.length > 0 ? uncapped : batch;
    const chosen = pick(working);
    pool.tracks.push(chosen);
    pool.ids.add(chosen.id);
    F.noteQueued(pool, chosen);
  }
}

// ── Scenarios: how the simulated user behaves ─────────────────────────────────
const SCENARIOS = {
  'hot-streak': {
    blurb: 'Likes everything Pop, rejects everything else. Can the feed collapse?',
    act: (track) => (track.genre_name === 'Pop' ? 'like' : 'reject'),
    gapMs: () => 3_000,
  },
  alternating: {
    blurb: 'Strict like/reject alternation. Does momentum thrash?',
    act: (_t, i) => (i % 2 === 0 ? 'like' : 'reject'),
    gapMs: () => 3_000,
  },
  'mid-session-pause': {
    blurb: 'A Pop streak, a 30-minute break, then more. Does momentum reset?',
    act: (track) => (track.genre_name === 'Pop' ? 'like' : 'reject'),
    gapMs: (i, total) => (i === Math.floor(total / 2) ? 31 * 60_000 : 3_000),
  },
  'cold-start': {
    blurb: 'Only a handful of swipes. Momentum should stay off entirely.',
    act: () => (rnd() < 0.5 ? 'like' : 'reject'),
    gapMs: () => 3_000,
  },
  eclectic: {
    blurb: 'Likes a bit of everything. Baseline for comparison.',
    act: () => (rnd() < 0.55 ? 'like' : 'reject'),
    gapMs: () => 3_000,
  },
};

// ── Metrics ───────────────────────────────────────────────────────────────────
function longestRun(rows, key, window) {
  let worst = 0;
  for (let i = 0; i + window <= rows.length; i++) {
    const counts = new Map();
    for (const r of rows.slice(i, i + window)) {
      const k = r[key];
      if (k != null) counts.set(k, (counts.get(k) || 0) + 1);
    }
    worst = Math.max(worst, 0, ...counts.values());
  }
  return worst;
}

function bar(n, total, width = 28) {
  const filled = Math.round((n / total) * width);
  return '#'.repeat(filled).padEnd(width, '.');
}

function run(name, swipes) {
  const sc = SCENARIOS[name];
  const pool = M.makePool([]);
  const served = [];
  const history = [];          // newest-first, the shape getSessionSwipes returns
  const trajectory = [];
  let relaxations = 0;
  const breaches = [];
  let clock = Date.now();

  for (let i = 0; i < swipes; i++) {
    topUp(pool);

    // Momentum is normally read from the DB; here it is computed from the
    // simulated history and injected, keeping the run database-free.
    const cold = history.length < 5; // COLD_START_THRESHOLD
    const momentum = cold ? M.EMPTY_MOMENTUM : M.momentumFrom(history.slice(0, 40), clock);
    pool.momentumCache = { at: clock, value: momentum };

    // Was there any option that breached nothing? If not, whatever comes back
    // is a forced relaxation, and a resulting run is by design rather than a
    // failed guard. Recorded so breaches can be attributed, not guessed at.
    const hadCleanOption = pool.tracks.some(t => !M.violatesServed(pool, t));
    const wasForcedExplore = pool.sinceExploreServed >= EXPLORE_EVERY;
    const servedBefore = [...pool.served]; // snapshot: noteServed mutates it

    const track = M.reRankAndServe(USER, pool);
    if (!track) break;
    if (!hadCleanOption) relaxations++;

    // Attribute any breach to the decision that caused it, rather than
    // inferring it from the aggregate afterwards.
    const cost = M.servedBreachCost({ served: servedBefore }, track);
    if (cost > 0) {
      breaches.push({ at: i, cost, forcedExplore: wasForcedExplore, hadCleanOption });
    }
    served.push(track);

    trajectory.push(M.multGenre(momentum, { genre_id: 132, genre_name: 'Pop' }));

    const action = sc.act(track, i);
    clock += sc.gapMs(i, swipes);
    history.unshift({
      action, genre_id: track.genre_id, genre_name: track.genre_name,
      artist_id: track.artist_id, created_at: clock,
    });
  }

  return { served, trajectory, relaxations, breaches };
}

function report(name, swipes) {
  const sc = SCENARIOS[name];
  const { served, trajectory, relaxations, breaches } = run(name, swipes);
  const n = served.length;

  console.log(`\n${'='.repeat(66)}`);
  console.log(`${name}  (${n} cards)`);
  console.log(`${sc.blurb}`);
  console.log('='.repeat(66));

  const byGenre = new Map();
  for (const t of served) byGenre.set(t.genre_name, (byGenre.get(t.genre_name) || 0) + 1);
  console.log('\n  genre distribution');
  for (const [g, c] of [...byGenre].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${g.padEnd(14)}${bar(c, n)} ${String(c).padStart(3)}  ${((c / n) * 100).toFixed(0)}%`);
  }

  const caps = [
    ['artist', 'artist_id', 10, F.MAX_SAME_ARTIST],
    ['album', 'album_id', 10, F.MAX_SAME_ALBUM],
    ['genre', 'genre_name', 5, F.MAX_SAME_GENRE],
  ];
  console.log('\n  worst run in any window (served order)');
  let violations = 0;
  const avoidableBreaches = breaches.filter(b => !b.forcedExplore && b.hadCleanOption).length;
  for (const [label, key, win, cap] of caps) {
    const worst = longestRun(served, key, win);
    const ok = worst <= cap;
    // A breach only indicts the guard if it was avoidable — that is, if a clean
    // option existed and the serve was not a forced discovery pick. The
    // EXPLORE_EVERY floor deliberately outranks the caps, so runs it causes are
    // the design working, not the design failing.
    const excused = !ok && avoidableBreaches === 0;
    if (!ok && !excused) violations++;
    console.log(`    ${ok ? 'ok  ' : excused ? 'note' : 'FAIL'} ${label.padEnd(7)} ${worst} in ${win}  (cap ${cap})`);
  }
  console.log(`    ${relaxations} of ${n} serves had no un-breached option available`);
  if (breaches.length > 0) {
    const forced = breaches.filter(b => b.forcedExplore).length;
    const avoidable = breaches.filter(b => !b.forcedExplore && b.hadCleanOption).length;
    console.log(`    breaching serves: ${breaches.length}  (${forced} forced-discovery, ${avoidable} avoidable)`);
    if (avoidable > 0) console.log(`    first avoidable at serve #${breaches.find(b => !b.forcedExplore && b.hadCleanOption).at}`);
  }

  // Adjacency is deliberately discouraged rather than blocked, so this is a
  // rate to watch, not a pass/fail. It should be near zero but need not be zero
  // — a strong enough affinity or momentum tilt is allowed to win.
  let adjacentPairs = 0;
  for (let i = 1; i < n; i++) {
    if (served[i].artist_id && served[i].artist_id === served[i - 1].artist_id) adjacentPairs++;
  }
  console.log(`\n  back-to-back same artist: ${adjacentPairs} of ${Math.max(0, n - 1)} transitions  (soft penalty, not a block)`);

  const explores = served.filter(t => t.via === 'explore').length;
  const rate = explores / n;
  // The floor is the forced-serve guarantee, not EPSILON itself: EXPLORE_EVERY
  // ensures at least one discovery card per that many served.
  const floor = 1 / (EXPLORE_EVERY + 1);
  console.log('\n  exploration');
  if (n <= EXPLORE_EVERY) {
    // Too short for the forced-serve floor to have fired even once; measuring a
    // rate here would fail a run that is behaving correctly.
    console.log(`    n/a  only ${n} cards — shorter than the forced-serve interval`);
  } else {
    const rateOk = rate >= Math.min(EPSILON, floor) * 0.75;
    if (!rateOk) violations++;
    console.log(`    ${rateOk ? 'ok  ' : 'FAIL'} realized rate ${(rate * 100).toFixed(0)}%  (epsilon ${EPSILON * 100}%, forced floor ${(floor * 100).toFixed(0)}%)`);
  }

  const maxMult = Math.max(...trajectory);
  const endMult = trajectory[trajectory.length - 1];
  console.log('\n  Pop momentum multiplier');
  console.log(`    peak ${maxMult.toFixed(3)}   final ${endMult.toFixed(3)}   bound [${(1 - M.BETA_GENRE).toFixed(2)}, ${(1 + M.BETA_GENRE).toFixed(2)}]`);
  const inBounds = trajectory.every(m => m <= 1 + M.BETA_GENRE + 1e-9 && m >= 1 - M.BETA_GENRE - 1e-9);
  if (!inBounds) violations++;
  console.log(`    ${inBounds ? 'ok  ' : 'FAIL'} stayed inside the anchoring bound throughout`);

  const distinctArtists = new Set(served.map(t => t.artist_id)).size;
  console.log(`\n  variety: ${byGenre.size} genres, ${distinctArtists} artists across ${n} cards`);

  return violations;
}

const only = arg('scenario', null);
const swipes = Number(arg('swipes', 120));
const names = only ? [only] : Object.keys(SCENARIOS);

if (only && !SCENARIOS[only]) {
  console.error(`Unknown scenario "${only}". Available: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(1);
}

let total = 0;
for (const name of names) {
  total += report(name, name === 'cold-start' ? Math.min(swipes, 4) : swipes);
}

console.log(`\n${'='.repeat(66)}`);
console.log(total === 0
  ? 'All scenarios held every guard.'
  : `${total} guard violation(s) across ${names.length} scenario(s).`);
process.exit(total === 0 ? 0 : 1);
