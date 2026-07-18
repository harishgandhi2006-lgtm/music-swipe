import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from './auth/AuthContext.jsx';
import AuthScreen from './auth/AuthScreen.jsx';
import DiscoverView from './views/DiscoverView.jsx';
import FriendsView from './views/FriendsView.jsx';
import InboxView from './views/InboxView.jsx';
import ProfileView from './views/ProfileView.jsx';
import BottomNav from './components/BottomNav.jsx';
import FeedbackToast from './components/FeedbackToast.jsx';
import { fetchUnseenCount } from './api.js';

export default function App() {
  const { user, loading } = useAuth();
  const [view, setView] = useState('discover');
  const [toast, setToast] = useState(null);
  const [friendProfileId, setFriendProfileId] = useState(null);
  const [unseenCount, setUnseenCount] = useState(0);

  // Poll unseen inbox count every 30s when logged in
  useEffect(() => {
    if (!user) return;
    const refresh = () => fetchUnseenCount().then(d => setUnseenCount(d.count)).catch(() => {});
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Refresh count when switching to inbox
  useEffect(() => {
    if (view === 'inbox' && user) {
      setTimeout(() => fetchUnseenCount().then(d => setUnseenCount(d.count)).catch(() => {}), 800);
    }
  }, [view, user]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  }, []);

  const handleBadgeUnlocked = useCallback((badge) => {
    // Delay slightly so it doesn't clash with the swipe toast
    setTimeout(() => showToast({ type: 'badge', ...badge }), 700);
  }, [showToast]);

  function handleNavigate(v) {
    setView(v);
    setFriendProfileId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0f0f0f]">
        <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  return (
    <div className="flex flex-col h-screen max-w-sm mx-auto bg-[#0f0f0f] select-none overflow-hidden">
      {/* Views */}
      <div className="flex-1 overflow-hidden relative">
        {view === 'discover' && (
          <DiscoverView
            onBadgeUnlocked={handleBadgeUnlocked}
            showToast={showToast}
          />
        )}
        {view === 'friends' && (
          <FriendsView
            onOpenProfile={setFriendProfileId}
            showToast={showToast}
          />
        )}
        {view === 'inbox' && (
          <InboxView showToast={showToast} />
        )}
        {view === 'profile' && (
          <ProfileView userId={user.id} />
        )}

        {/* Friend profile overlay */}
        <AnimatePresence>
          {friendProfileId && (
            <motion.div
              className="absolute inset-0 z-30 bg-[#0f0f0f]"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            >
              <ProfileView
                userId={friendProfileId}
                onBack={() => setFriendProfileId(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom nav */}
      <BottomNav
        activeView={view}
        onNavigate={handleNavigate}
        unseenCount={unseenCount}
      />

      {/* Global toast */}
      <FeedbackToast toast={toast} />
    </div>
  );
}
