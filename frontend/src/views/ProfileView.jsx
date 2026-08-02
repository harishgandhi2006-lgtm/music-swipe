import { useState, useEffect } from 'react';
import { fetchProfile } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import GenrePieChart from '../components/GenrePieChart.jsx';
import TopArtistsList from '../components/TopArtistsList.jsx';
import BadgeDisplay from '../components/BadgeDisplay.jsx';

export default function ProfileView({ onOpenSettings }) {
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchProfile()
      .then(setProfile)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-6 pb-4 shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-white font-bold text-xl tracking-tight truncate">My Profile</h1>
        </div>
        <button
          onClick={onOpenSettings}
          className="text-white/30 hover:text-white/60 transition p-1.5"
          aria-label="Discovery settings"
        >
          ⚙
        </button>
        <button
          onClick={logout}
          className="text-white/30 text-xs hover:text-white/60 transition px-2 py-1"
        >
          Sign out
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : !profile ? (
        <p className="text-white/30 text-sm text-center py-16">Profile not found</p>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {/* Avatar */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-400/40 to-blue-500/40 border border-white/10 flex items-center justify-center text-3xl font-bold text-white shrink-0">
              {(user?.username || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-lg">{user?.username}</p>
              <p className="text-white/40 text-xs">
                {profile.genres?.reduce((s, g) => s + g.likes, 0) || 0} songs liked
              </p>
            </div>
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
            <TopArtistsList artists={profile.artists} />
          </Section>
        </div>
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
