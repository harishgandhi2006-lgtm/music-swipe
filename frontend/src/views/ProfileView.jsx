import { useState, useEffect } from 'react';
import { fetchUserProfile, sendFriendRequest, respondFriendRequest } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import GenrePieChart from '../components/GenrePieChart.jsx';
import TopArtistsList from '../components/TopArtistsList.jsx';
import BadgeDisplay from '../components/BadgeDisplay.jsx';
import ShareModal from '../components/ShareModal.jsx';

export default function ProfileView({ userId, onBack }) {
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requestSent, setRequestSent] = useState(false);
  const [sharingArtist, setSharingArtist] = useState(null);

  const isOwnProfile = !userId || userId === user?.id;
  const targetId = isOwnProfile ? user?.id : userId;

  useEffect(() => {
    if (!targetId) return;
    setLoading(true);
    fetchUserProfile(targetId)
      .then(setProfile)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [targetId]);

  async function handleAddFriend() {
    setRequestSent(true);
    await sendFriendRequest(targetId).catch(console.error);
  }

  async function handleRespond(status) {
    const fid = profile?.friendship?.id;
    if (!fid) return;
    await respondFriendRequest(fid, status).catch(console.error);
    setProfile(p => ({ ...p, friendship: { ...p.friendship, status } }));
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-6 pb-4 shrink-0">
        {onBack && (
          <button onClick={onBack} className="w-9 h-9 flex items-center justify-center text-white/60 hover:text-white transition">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-white font-bold text-xl tracking-tight truncate">
            {isOwnProfile ? 'My Profile' : profile?.username || '...'}
          </h1>
          {!isOwnProfile && (
            <p className="text-white/40 text-xs mt-0.5">Music taste</p>
          )}
        </div>
        {isOwnProfile && (
          <button
            onClick={logout}
            className="text-white/30 text-xs hover:text-white/60 transition px-2 py-1"
          >
            Sign out
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : !profile ? (
        <p className="text-white/30 text-sm text-center py-16">Profile not found</p>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {/* Avatar + friend action */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-400/40 to-blue-500/40 border border-white/10 flex items-center justify-center text-3xl font-bold text-white shrink-0">
              {(profile.username || user?.username || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-lg">{isOwnProfile ? user?.username : profile.username}</p>
              <p className="text-white/40 text-xs">
                {profile.genres?.reduce((s, g) => s + g.likes, 0) || 0} songs liked
              </p>
            </div>
            {!isOwnProfile && <FriendButton friendship={profile.friendship} onAdd={handleAddFriend} onRespond={handleRespond} sent={requestSent} />}
          </div>

          {/* Badges */}
          <Section title="Badges">
            <BadgeDisplay badges={profile.badges} />
          </Section>

          {/* Genre breakdown */}
          <Section title="Music Taste">
            <GenrePieChart genres={profile.genres} />
          </Section>

          {/* Top artists */}
          <Section title="Top Artists">
            <TopArtistsList
              artists={profile.artists}
              onShare={a => setSharingArtist({
                id: a.artist_id,
                name: a.artist_name,
                cover_url: a.cover_url,
              })}
            />
          </Section>
        </div>
      )}

      {sharingArtist && (
        <ShareModal artist={sharingArtist} onClose={() => setSharingArtist(null)} />
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <p className="text-white/40 text-xs uppercase tracking-widest mb-3">{title}</p>
      {children}
    </div>
  );
}

function FriendButton({ friendship, onAdd, onRespond, sent }) {
  if (friendship?.status === 'accepted') {
    return <span className="text-green-400 text-xs font-semibold bg-green-400/10 px-3 py-1.5 rounded-xl">✓ Friends</span>;
  }
  if (friendship?.status === 'pending' && friendship?.isRequester) {
    return <span className="text-white/30 text-xs font-semibold">Request sent</span>;
  }
  if (friendship?.status === 'pending' && !friendship?.isRequester) {
    return (
      <div className="flex gap-2">
        <button onClick={() => onRespond('accepted')} className="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-xl hover:bg-green-400 transition">Accept</button>
        <button onClick={() => onRespond('declined')} className="px-3 py-1.5 bg-white/10 text-white/60 text-xs font-bold rounded-xl hover:bg-white/15 transition">Decline</button>
      </div>
    );
  }
  return (
    <button
      onClick={onAdd}
      disabled={sent}
      className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
        sent ? 'bg-white/5 text-white/30 cursor-default' : 'bg-white/15 text-white hover:bg-white/25 active:scale-95'
      }`}
    >
      {sent ? '✓ Sent' : '+ Add Friend'}
    </button>
  );
}
