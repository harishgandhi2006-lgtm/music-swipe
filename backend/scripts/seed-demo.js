/**
 * Seed (or remove) demo accounts so the social features have something to show
 * on a fresh database.
 *
 *   node scripts/seed-demo.js            seed
 *   node scripts/seed-demo.js --remove   remove every demo_* account and its data
 *
 * Every account it creates is prefixed `demo_`, and --remove only ever touches
 * that prefix, so real accounts are never affected.
 */
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from '../db.js';
import { evaluateBadges } from '../services/badges.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlite = new DatabaseSync(join(__dirname, '..', 'music_swipe.db'));

const PREFIX = 'demo_';
const PASSWORD = 'demo1234';

// ── Demo cast ────────────────────────────────────────────────────────────────
// Taste profiles are shaped relative to the primary account so the Taste
// Matcher produces a spread of scores rather than a wall of 100%s.
const CAST = [
  {
    username: 'demo_maya',
    genres: { Pop: 22, Alternative: 14, Electro: 7 },
    artists: { 'Justin Bieber': 5, 'Bruno Mars': 4, sombr: 3, Vales: 2 },
    relation: 'friend',   // already accepted — can appear in Friends + share
  },
  {
    username: 'demo_leo',
    genres: { Pop: 10, Rock: 20, Alternative: 6 },
    artists: { 'Bruno Mars': 3, 'AC/DC': 4 },
    relation: 'requested', // pending request TO the primary user
  },
  {
    username: 'demo_kai',
    genres: { Electro: 16, Dance: 9, Pop: 6 },
    artists: { 'Justin Bieber': 2, 'Etienne de Crécy': 4 },
    relation: 'none',      // shows up in Discover
  },
  {
    username: 'demo_nia',
    // Small, close-to-primary profile: high overlap on a short history is what
    // the confidence model treats as a strong match. Shows the top of the range.
    genres: { Pop: 3, Alternative: 2, Electro: 2 },
    artists: { 'Justin Bieber': 2, 'Bruno Mars': 1, sombr: 1, Vales: 1 },
    relation: 'none',
  },
  {
    username: 'demo_zara',
    // Mostly her own thing, with a little common ground — bottom of the range.
    genres: { Jazz: 14, Classical: 11, 'R&B': 8, Pop: 2, Alternative: 3, Electro: 2 },
    artists: { 'George McCrae': 3 },
    relation: 'none',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function genreIdFor(name) {
  return sqlite.prepare('SELECT genre_id FROM tracks WHERE genre_name = ? LIMIT 1').get(name)?.genre_id ?? null;
}

function artistIdFor(name) {
  return sqlite.prepare('SELECT artist_id FROM tracks WHERE artist_name = ? LIMIT 1').get(name)?.artist_id ?? null;
}

function tracksInGenre(name, limit) {
  return sqlite.prepare(
    "SELECT id FROM tracks WHERE genre_name = ? AND preview_url != '' ORDER BY rank DESC LIMIT ?"
  ).all(name, limit).map(r => r.id);
}

function primaryUser() {
  return sqlite.prepare(
    `SELECT id, username FROM users WHERE username NOT LIKE '${PREFIX}%' ORDER BY id LIMIT 1`
  ).get() || null;
}

// ── Remove ───────────────────────────────────────────────────────────────────
function remove() {
  const demos = sqlite.prepare(`SELECT id, username FROM users WHERE username LIKE '${PREFIX}%'`).all();
  if (demos.length === 0) {
    console.log('No demo accounts found — nothing to remove.');
    return;
  }
  for (const u of demos) {
    sqlite.prepare('DELETE FROM shared_items WHERE sender_id = ? OR receiver_id = ?').run(u.id, u.id);
    sqlite.prepare('DELETE FROM friendships WHERE user_id_1 = ? OR user_id_2 = ?').run(u.id, u.id);
    sqlite.prepare('DELETE FROM badges WHERE user_id = ?').run(u.id);
    sqlite.prepare('DELETE FROM interactions WHERE user_id = ?').run(String(u.id));
    sqlite.prepare('DELETE FROM genre_scores WHERE user_id = ?').run(String(u.id));
    sqlite.prepare('DELETE FROM artist_scores WHERE user_id = ?').run(String(u.id));
    sqlite.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    console.log(`  removed ${u.username}`);
  }
  console.log(`\nRemoved ${demos.length} demo account(s).`);
}

// ── Seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  const primary = primaryUser();
  if (!primary) {
    console.log('No real account exists yet — sign up first, then re-run this script.');
    return;
  }
  console.log(`Primary account: ${primary.username} (id ${primary.id})\n`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const created = [];

  for (const person of CAST) {
    if (db.getUserByUsername(person.username)) {
      console.log(`  ${person.username} already exists — skipping`);
      continue;
    }

    const user = db.createUser(person.username, hash);
    created.push({ ...person, id: user.id });

    // Taste profile. Interactions are inserted alongside the score rows so
    // total-swipe badges and "songs liked" counts line up with the profile.
    for (const [genreName, likes] of Object.entries(person.genres)) {
      const gid = genreIdFor(genreName);
      if (gid == null) continue;
      const rejects = Math.floor(likes / 3);
      db.upsertGenreScore(user.id, gid, genreName, likes, rejects);

      const pool = tracksInGenre(genreName, likes + rejects);
      pool.forEach((trackId, i) => {
        sqlite.prepare(
          'INSERT INTO interactions (user_id, track_id, action, created_at) VALUES (?, ?, ?, ?)'
        ).run(String(user.id), trackId, i < likes ? 'like' : 'reject', Date.now() - i * 60000);
      });
    }

    for (const [artistName, likes] of Object.entries(person.artists)) {
      const aid = artistIdFor(artistName);
      if (aid != null) db.upsertArtistScore(user.id, aid, artistName, likes, 0);
    }

    const badges = evaluateBadges(String(user.id), user.id);
    console.log(`  created ${person.username} — ${badges.length} badge(s): ${badges.map(b => b.label).join(', ') || 'none'}`);
  }

  // Relationships to the primary account
  for (const person of created) {
    if (person.relation === 'friend') {
      db.sendFriendRequest(person.id, primary.id);
      const f = db.getFriendshipStatus(person.id, primary.id);
      if (f) sqlite.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(f.id);
      console.log(`  ${person.username} → friends with ${primary.username}`);
    } else if (person.relation === 'requested') {
      db.sendFriendRequest(person.id, primary.id);
      console.log(`  ${person.username} → sent a friend request to ${primary.username}`);
    }
  }

  // Inbox content, from the one account that's actually a friend.
  const friend = created.find(p => p.relation === 'friend');
  if (friend) {
    const picks = tracksInGenre('Pop', 2);
    const messages = ['this one is so you 🎧', 'on repeat all week'];
    picks.forEach((trackId, i) => db.shareItem(friend.id, primary.id, 'track', trackId, messages[i] || null));

    const artistId = artistIdFor('Bruno Mars');
    if (artistId != null) {
      db.shareItem(friend.id, primary.id, 'artist', artistId, 'you need this whole discography');
    }
    console.log(`  ${friend.username} → shared ${picks.length} track(s) + 1 artist to ${primary.username}'s inbox`);
  }

  console.log(`\nDone. ${created.length} demo account(s) created.`);
  if (created.length) console.log(`Log in as any of them with password: ${PASSWORD}`);
}

const mode = process.argv.includes('--remove') ? 'remove' : 'seed';
if (mode === 'remove') remove();
else await seed();
