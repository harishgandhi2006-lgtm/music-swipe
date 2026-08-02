import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import db from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, '../routes/public.js'), 'utf8');

describe('public-preview route stays genuinely unauthenticated', () => {
  it('never references requireAuth, req.userId, or an authorization header', () => {
    assert.equal(/requireAuth/.test(source), false);
    assert.equal(/req\.userId/.test(source), false);
    assert.equal(/req\.headers\.authorization/.test(source), false);
  });

  it('never imports the auth middleware module', () => {
    assert.equal(/from ['"]\.\.\/middleware\/auth\.js['"]/.test(source), false);
  });
});

describe('public-preview data shape', () => {
  const TRACK_ID = 88002;

  it('returns only public catalogue fields for a cached track', () => {
    db.upsertTrack({
      id: TRACK_ID, title: 'Public Song', artist_name: 'Public Artist', artist_id: 7800,
      album_title: 'Public Album', album_id: 7801, cover_url: 'https://example.test/cover.jpg',
      preview_url: '', genre_id: 7802, genre_name: 'PublicGenre', duration: 200,
      rank: 400000, fetched_at: Date.now(),
    });

    const track = db.getTrack(TRACK_ID);
    assert.ok(track);
    assert.equal(track.title, 'Public Song');
    // No user_id column exists on `tracks` at all — structurally, this table
    // cannot carry cross-user linkage for the public route to leak.
    assert.equal('user_id' in track, false);
  });
});
