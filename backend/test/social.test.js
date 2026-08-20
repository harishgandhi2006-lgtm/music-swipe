import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import db from '../db.js';
import {
  sendConnectionRequest, respondToRequest, listConnections, listPendingRequests,
  recordActivity, getActivityFeed, SocialError,
} from '../services/social.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeUser(username) {
  return db.createUser(username, 'hash').id;
}

describe('connection request state machine', () => {
  it('starts pending and moves to accepted on accept', () => {
    const a = makeUser('alice1');
    const b = makeUser('bob1');
    const req = sendConnectionRequest(a, 'bob1');
    assert.equal(req.status, 'pending');

    const updated = respondToRequest(b, req.id, true);
    assert.equal(updated.status, 'accepted');
    assert.ok(listConnections(a).includes(String(b)));
    assert.ok(listConnections(b).includes(String(a)));
  });

  it('moves to declined on decline, and creates no connection', () => {
    const a = makeUser('alice2');
    const b = makeUser('bob2');
    const req = sendConnectionRequest(a, 'bob2');
    const updated = respondToRequest(b, req.id, false);
    assert.equal(updated.status, 'declined');
    assert.equal(listConnections(a).includes(String(b)), false);
  });

  it('refuses a second pending request for the same pair', () => {
    const a = makeUser('alice3');
    makeUser('bob3');
    sendConnectionRequest(a, 'bob3');
    assert.throws(() => sendConnectionRequest(a, 'bob3'), SocialError);
  });

  it('auto-accepts when the addressee already sent a pending request the other way', () => {
    const a = makeUser('alice4');
    const b = makeUser('bob4');
    sendConnectionRequest(a, 'bob4'); // a -> b, pending
    const result = sendConnectionRequest(b, 'alice4'); // b -> a, should accept a's request
    assert.equal(result.status, 'accepted');
    assert.ok(listConnections(a).includes(String(b)));
  });

  it('refuses a request to yourself', () => {
    const a = makeUser('alice5');
    assert.throws(() => sendConnectionRequest(a, 'alice5'), SocialError);
  });

  it('refuses responding to a request that is not addressed to you', () => {
    const a = makeUser('alice6');
    const b = makeUser('bob6');
    makeUser('carol6');
    const req = sendConnectionRequest(a, 'bob6');
    assert.throws(() => respondToRequest(999999, req.id, true), SocialError);
    // sanity: still pending, since the bad respond attempt above must not
    // have mutated state despite throwing
    assert.equal(db.getConnectionRequestById(req.id).status, 'pending');
    void b;
  });

  it('lists only pending requests addressed to the caller', () => {
    const a = makeUser('alice7');
    const b = makeUser('bob7');
    sendConnectionRequest(a, 'bob7');
    const pending = listPendingRequests(b);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].requester_id, String(a));
  });
});

describe('activity feed scoping', () => {
  it('only surfaces activity from accepted connections, not arbitrary users', () => {
    const a = makeUser('alice8');
    const b = makeUser('bob8');
    const stranger = makeUser('stranger8');

    const req = sendConnectionRequest(a, 'bob8');
    respondToRequest(b, req.id, true);

    recordActivity(b, 'like', { title: 'Song B' });
    recordActivity(stranger, 'like', { title: 'Song Stranger' });

    const feed = getActivityFeed(a);
    assert.equal(feed.length, 1);
    assert.equal(feed[0].user_id, String(b));
    assert.equal(JSON.parse(feed[0].payload).title, 'Song B');
  });

  it('returns nothing for a user with no connections', () => {
    const a = makeUser('alice9');
    assert.deepEqual(getActivityFeed(a), []);
  });
});

describe('social layer stays isolated from the recommender', () => {
  // Checks for an actual import, not the word appearing in an explanatory
  // comment (both files' comments legitimately mention the other by name
  // while documenting that no such import exists — see policy-guard.test.js
  // for the same "match a call/import, not a comment" approach).
  it('recommender.js does not import social.js or any social_* table helper', () => {
    const source = readFileSync(join(__dirname, '../services/recommender.js'), 'utf8');
    assert.equal(/from\s+['"].*social/i.test(source), false);
    assert.equal(/social_(connection|activity)/i.test(source), false);
  });

  it('social.js does not import recommender.js', () => {
    const source = readFileSync(join(__dirname, '../services/social.js'), 'utf8');
    assert.equal(/from\s+['"].*recommender/i.test(source), false);
  });
});
