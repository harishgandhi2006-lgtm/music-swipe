import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import db from '../db.js';
import { updateAffinityScores } from '../services/recommender.js';

const USER = '__undo_test__';
const TRACK_ID = 88001;

describe('deleteRecentInteraction + updateAffinityScores — undo round-trip', () => {
  before(() => {
    db.upsertTrack({
      id: TRACK_ID, title: 'Undo Song', artist_name: 'Undo Artist', artist_id: 7700,
      album_title: 'Undo Album', album_id: 7701, cover_url: '', preview_url: '',
      genre_id: 7702, genre_name: 'UndoGenre', duration: 180, rank: 500000,
      fetched_at: Date.now(),
    });
  });

  it('recomputes genre/artist scores back to baseline after an undo', () => {
    db.insertInteraction(USER, TRACK_ID, 'like');
    updateAffinityScores(USER, TRACK_ID);

    assert.equal(db.getGenreScore(USER, 7702), db.getGenreScore(USER, 7702)); // sanity: no throw
    assert.ok(db.getGenreScore(USER, 7702) > 0.5, 'a fresh like should raise the genre score above the prior');
    assert.ok(db.getArtistScore(USER, 7700) > 0.5, 'a fresh like should raise the artist score above the prior');

    const removed = db.deleteRecentInteraction(USER, TRACK_ID, 10_000);
    assert.ok(removed, 'a fresh interaction should be found and removed');
    assert.equal(removed.action, 'like');

    updateAffinityScores(USER, TRACK_ID);
    assert.equal(db.getGenreScore(USER, 7702), 0.5, 'genre score should return to the no-evidence prior');
    assert.equal(db.getArtistScore(USER, 7700), 0.5, 'artist score should return to the no-evidence prior');
  });

  it('returns null and leaves rows untouched when the match is too old', () => {
    const OLD_USER = '__undo_test_old__';
    db.insertInteraction(OLD_USER, TRACK_ID, 'reject');

    const removed = db.deleteRecentInteraction(OLD_USER, TRACK_ID, -1); // any age counts as "too old"
    assert.equal(removed, null);

    // Row is still there: a second delete with a real window succeeds.
    const stillThere = db.deleteRecentInteraction(OLD_USER, TRACK_ID, 10_000);
    assert.ok(stillThere);
  });

  it('returns null when there is no matching interaction at all', () => {
    assert.equal(db.deleteRecentInteraction('__nobody__', TRACK_ID, 10_000), null);
  });

  it('only removes the newest matching row, not an earlier one', () => {
    const RESWIPE_USER = '__undo_test_reswipe__';
    db.insertInteraction(RESWIPE_USER, TRACK_ID, 'reject');
    db.insertInteraction(RESWIPE_USER, TRACK_ID, 'like');

    const removed = db.deleteRecentInteraction(RESWIPE_USER, TRACK_ID, 10_000);
    assert.equal(removed.action, 'like', 'the most recent swipe (like) should be the one undone');

    const history = db.getHistory(RESWIPE_USER, 10);
    assert.equal(history.length, 1);
    assert.equal(history[0].action, 'reject', 'the earlier reject should remain');
  });
});
