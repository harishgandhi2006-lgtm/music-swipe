import { EventEmitter } from 'events';
import db from '../db.js';

// Walled off from the recommendation engine by construction: this file has
// zero imports from recommender.js, and nothing in recommender.js imports
// from here. Every table this module touches (social_connection_requests,
// social_connections, social_activity_events) is likewise never read by
// getNextTrack/pickBest/reRankAndServe. See ARCHITECTURE.md and
// .claude/skills/audit-isolation/SKILL.md for the constraint this enforces.

// Push-driven event bus for real-time social updates — SSE handlers in
// routes/social.js subscribe per-user (`user:${userId}`). Populated only by
// the write paths below, never polled from a read path: polling SQLite per
// open connection at ~1,000-connection scale would reintroduce the exact
// synchronous DB fan-out problem the Phase 1 recommender work fixed. See
// ARCHITECTURE.md's SSE section.
export const socialBus = new EventEmitter();
socialBus.setMaxListeners(0); // one listener per open SSE connection, unbounded

function emitToUser(userId, event, data) {
  socialBus.emit(`user:${userId}`, { event, data });
}

export class SocialError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function sendConnectionRequest(requesterId, addresseeUsername) {
  const addressee = db.getUserByUsername(addresseeUsername);
  if (!addressee) throw new SocialError('User not found', 404);
  if (String(addressee.id) === String(requesterId)) {
    throw new SocialError('Cannot send a connection request to yourself');
  }

  const existing = db.getConnectionRequest(requesterId, addressee.id);
  if (existing?.status === 'pending') throw new SocialError('Request already pending', 409);
  if (existing?.status === 'accepted') throw new SocialError('Already connected', 409);

  // The other direction already has a pending request — accept it instead
  // of creating a second, redundant one pointed the other way.
  const reverse = db.getConnectionRequest(addressee.id, requesterId);
  if (reverse?.status === 'pending') {
    const updated = db.updateConnectionRequestStatus(reverse.id, 'accepted');
    db.createConnection(requesterId, addressee.id);
    emitToUser(addressee.id, 'connection_accepted', { userId: requesterId });
    return updated;
  }

  const request = db.createConnectionRequest(requesterId, addressee.id);
  emitToUser(addressee.id, 'connection_request', { requestId: request.id, from: requesterId });
  return request;
}

export function respondToRequest(userId, requestId, accept) {
  const request = db.getConnectionRequestById(requestId);
  if (!request) throw new SocialError('Request not found', 404);
  if (String(request.addressee_id) !== String(userId)) {
    throw new SocialError('Not your request to respond to', 403);
  }
  if (request.status !== 'pending') throw new SocialError('Request already resolved', 409);

  const status = accept ? 'accepted' : 'declined';
  const updated = db.updateConnectionRequestStatus(requestId, status);
  if (accept) {
    db.createConnection(request.requester_id, request.addressee_id);
    emitToUser(request.requester_id, 'connection_accepted', { userId });
  }
  return updated;
}

export function listConnections(userId) {
  return db.listConnections(userId);
}

export function listPendingRequests(userId) {
  return db.listPendingRequests(userId);
}

// `payload` must be display-only data (track title/artist, badge key) —
// never raw affinity/interaction rows. See the schema comment in db.js.
export function recordActivity(userId, type, payload) {
  const id = db.insertActivityEvent(userId, type, payload);
  for (const connectionId of db.listConnections(userId)) {
    emitToUser(connectionId, 'activity', { id, userId, type, payload });
  }
  return id;
}

// The one legitimately cross-user read in this module: scoped strictly to
// the caller's own accepted connections' activity metadata, never affinity/
// interaction/preference data.
export function getActivityFeed(userId, limit = 50) {
  const connectionIds = db.listConnections(userId);
  return db.getActivityFeed(connectionIds, limit);
}
