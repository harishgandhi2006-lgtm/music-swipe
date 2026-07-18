// Turn a 0..1 similarity score into something a person can read at a glance.
function matchLabel(score) {
  const pct = Math.round(score * 100);
  if (pct >= 75) return { pct, text: 'Perfect match', tone: 'text-green-400' };
  if (pct >= 50) return { pct, text: 'Strong match', tone: 'text-green-400/80' };
  if (pct >= 25) return { pct, text: 'Good match', tone: 'text-yellow-400/80' };
  return { pct, text: 'Some overlap', tone: 'text-white/40' };
}

export default function FriendCard({
  friend,
  onViewProfile,
  onRemove,
  onAccept,
  onDecline,
  onAdd,
  type = 'active',
  requestSent = false,
}) {
  const name = friend.friend_username || friend.requester_username || friend.username || '?';
  const initial = name[0].toUpperCase();
  const userId = friend.friend_id || friend.id;

  const isMatch = type === 'match';
  const match = isMatch ? matchLabel(friend.score ?? 0) : null;

  // What the two users actually have in common — the reason for the match.
  const shared = isMatch
    ? [...(friend.sharedArtists || []), ...(friend.sharedGenres || [])].slice(0, 3)
    : [];

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl ${isMatch ? 'bg-white/[0.07] border border-white/5' : 'bg-white/5'}`}>
      {/* Avatar */}
      <button
        onClick={() => onViewProfile?.(userId)}
        className="w-11 h-11 rounded-full bg-gradient-to-br from-green-400/30 to-blue-500/30 border border-white/10 flex items-center justify-center text-white font-bold text-lg shrink-0 hover:opacity-80 transition"
      >
        {initial}
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <button
          onClick={() => onViewProfile?.(userId)}
          className="text-white font-semibold text-sm hover:underline truncate block text-left"
        >
          {name}
        </button>

        {type === 'pending' && (
          <p className="text-white/40 text-xs mt-0.5">Wants to be friends</p>
        )}

        {isMatch && (
          <>
            <p className={`text-xs mt-0.5 font-medium ${match.tone}`}>
              {match.pct}% · {match.text}
            </p>
            {shared.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {shared.map(tag => (
                  <span
                    key={tag}
                    className="text-[10px] text-white/50 bg-white/5 px-1.5 py-0.5 rounded-md truncate max-w-[7rem]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      {type === 'active' && (
        <button
          onClick={() => onRemove?.(friend.friendship_id)}
          className="text-white/20 hover:text-red-400 transition text-xs px-2 py-1 rounded-lg hover:bg-white/5"
          title="Remove friend"
        >
          ✕
        </button>
      )}

      {type === 'pending' && (
        <div className="flex gap-2">
          <button
            onClick={() => onAccept?.(friend.friendship_id)}
            className="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-400 active:scale-95 transition-all"
          >
            Accept
          </button>
          <button
            onClick={() => onDecline?.(friend.friendship_id)}
            className="px-3 py-1.5 bg-white/10 text-white/60 text-xs font-bold rounded-lg hover:bg-white/15 active:scale-95 transition-all"
          >
            Decline
          </button>
        </div>
      )}

      {isMatch && (
        <button
          onClick={() => onAdd?.(userId)}
          disabled={requestSent}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg shrink-0 transition-all ${
            requestSent
              ? 'bg-white/5 text-white/30'
              : 'bg-green-500 text-white hover:bg-green-400 active:scale-95'
          }`}
        >
          {requestSent ? '✓ Sent' : 'Add'}
        </button>
      )}
    </div>
  );
}
