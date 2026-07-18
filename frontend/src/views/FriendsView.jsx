import { useState, useEffect, useCallback } from 'react';
import {
  fetchFriends, fetchPendingRequests, respondFriendRequest, removeFriend,
  fetchTasteMatches, sendFriendRequest,
} from '../api.js';
import FriendCard from '../components/FriendCard.jsx';
import UserSearchBar from '../components/UserSearchBar.jsx';

const TABS = ['Friends', 'Discover', 'Requests', 'Search'];

export default function FriendsView({ onOpenProfile, showToast }) {
  const [tab, setTab] = useState(0);
  const [friends, setFriends] = useState([]);
  const [pending, setPending] = useState([]);
  const [matches, setMatches] = useState([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [sentRequests, setSentRequests] = useState(new Set());
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [f, p] = await Promise.all([fetchFriends(), fetchPendingRequests()]);
      setFriends(f);
      setPending(p);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMatches = useCallback(async () => {
    setMatchesLoading(true);
    try {
      setMatches(await fetchTasteMatches());
    } catch {
      setMatches([]);
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadMatches(); }, [loadMatches]);

  async function handleAddMatch(userId) {
    // Optimistic — the row stays visible as "Sent" rather than vanishing,
    // so the list doesn't jump under the user's finger.
    setSentRequests(prev => new Set([...prev, userId]));
    try {
      await sendFriendRequest(userId);
      showToast?.('Friend request sent!');
    } catch {
      setSentRequests(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      showToast?.('Could not send request');
    }
  }

  async function handleAccept(friendshipId) {
    await respondFriendRequest(friendshipId, 'accepted').catch(console.error);
    showToast?.('Friend added!');
    loadAll();
    loadMatches(); // the new friend should drop out of Discover
  }

  async function handleDecline(friendshipId) {
    await respondFriendRequest(friendshipId, 'declined').catch(console.error);
    loadAll();
  }

  async function handleRemove(friendshipId) {
    await removeFriend(friendshipId).catch(console.error);
    setFriends(prev => prev.filter(f => f.friendship_id !== friendshipId));
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-6 pb-3 shrink-0">
        <h1 className="text-white font-bold text-xl tracking-tight">Friends</h1>
        <p className="text-white/40 text-xs mt-0.5">
          {friends.length} friend{friends.length !== 1 ? 's' : ''}
          {pending.length > 0 ? ` · ${pending.length} pending` : ''}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex px-4 gap-1 shrink-0">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition ${
              tab === i ? 'bg-white/15 text-white' : 'text-white/30 hover:text-white/50'
            }`}
          >
            {t}
            {t === 'Requests' && pending.length > 0 && (
              <span className="ml-1.5 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {pending.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 0 && (
          loading ? <Spinner /> : friends.length === 0 ? (
            <Empty icon="👥" text="No friends yet — search for people to add!" />
          ) : (
            <div className="flex flex-col gap-2">
              {friends.map(f => (
                <FriendCard
                  key={f.friendship_id}
                  friend={f}
                  type="active"
                  onViewProfile={onOpenProfile}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )
        )}

        {tab === 1 && (
          matchesLoading ? <Spinner /> : matches.length === 0 ? (
            <Empty
              icon="🎯"
              text="No taste matches yet — keep swiping and we'll find people who share your taste"
            />
          ) : (
            <>
              <p className="text-white/30 text-xs mb-3 px-1">
                People whose swipes look like yours
              </p>
              <div className="flex flex-col gap-2">
                {matches.map(m => (
                  <FriendCard
                    key={m.id}
                    friend={m}
                    type="match"
                    onViewProfile={onOpenProfile}
                    onAdd={handleAddMatch}
                    requestSent={sentRequests.has(m.id)}
                  />
                ))}
              </div>
            </>
          )
        )}

        {tab === 2 && (
          loading ? <Spinner /> : pending.length === 0 ? (
            <Empty icon="🔔" text="No pending requests" />
          ) : (
            <div className="flex flex-col gap-2">
              {pending.map(p => (
                <FriendCard
                  key={p.friendship_id}
                  friend={p}
                  type="pending"
                  onAccept={handleAccept}
                  onDecline={handleDecline}
                />
              ))}
            </div>
          )
        )}

        {tab === 3 && (
          <UserSearchBar onViewProfile={onOpenProfile} />
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-7 h-7 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  );
}

function Empty({ icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="text-4xl">{icon}</div>
      <p className="text-white/30 text-sm text-center">{text}</p>
    </div>
  );
}
