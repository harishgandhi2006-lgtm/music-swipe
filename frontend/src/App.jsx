import { useState, useCallback } from 'react';
import { useAuth } from './auth/AuthContext.jsx';
import AuthScreen from './auth/AuthScreen.jsx';
import DiscoverView from './views/DiscoverView.jsx';
import HistoryView from './views/HistoryView.jsx';
import ProfileView from './views/ProfileView.jsx';
import SettingsView from './views/SettingsView.jsx';
import BottomNav from './components/BottomNav.jsx';
import FeedbackToast from './components/FeedbackToast.jsx';
import SharePreviewView from './views/SharePreviewView.jsx';

export default function App() {
  const { user, loading } = useAuth();
  const [view, setView] = useState('discover');
  const [toast, setToast] = useState(null);

  // Checked before the auth gate below: a recipient opening a shared link has
  // no account, and must never be shown the login screen to see a preview.
  if (window.location.pathname === '/share') return <SharePreviewView />;

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  }, []);

  const handleBadgeUnlocked = useCallback((badge) => {
    // Delay slightly so it doesn't clash with the swipe toast
    setTimeout(() => showToast({ type: 'badge', ...badge }), 700);
  }, [showToast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0f0f0f]">
        <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  return (
    <div className="flex flex-col h-screen max-w-sm sm:max-w-md md:max-w-2xl lg:max-w-4xl mx-auto bg-[#0f0f0f] select-none overflow-hidden">
      {/* Views */}
      <div className="flex-1 overflow-hidden relative">
        {view === 'discover' && (
          <DiscoverView
            onBadgeUnlocked={handleBadgeUnlocked}
            showToast={showToast}
          />
        )}
        {view === 'history' && (
          <HistoryView />
        )}
        {view === 'profile' && (
          <ProfileView onOpenSettings={() => setView('settings')} />
        )}
        {view === 'settings' && (
          <SettingsView onBack={() => setView('profile')} />
        )}
      </div>

      {/* Bottom nav */}
      <BottomNav
        activeView={view}
        onNavigate={setView}
      />

      {/* Global toast */}
      <FeedbackToast toast={toast} />
    </div>
  );
}
