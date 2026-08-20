export default function BottomNav({ activeView, onNavigate }) {
  const tabs = [
    {
      id: 'discover',
      label: 'Discover',
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      ),
    },
    {
      id: 'history',
      label: 'History',
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <polyline points="12 7 12 12 15.5 14"/>
        </svg>
      ),
    },
    {
      id: 'profile',
      label: 'Profile',
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      ),
    },
  ];

  return (
    <nav className="flex bg-[#0f0f0f] border-t border-white/10 shrink-0">
      {tabs.map(tab => {
        const active = activeView === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onNavigate(tab.id)}
            className={`flex-1 flex flex-col items-center py-3 md:py-4 gap-1 md:gap-1.5 relative transition-colors ${
              active ? 'text-white' : 'text-white/30 hover:text-white/50'
            }`}
          >
            <span className="relative md:scale-110">
              {tab.icon(active)}
            </span>
            <span className={`text-[10px] md:text-xs font-medium ${active ? 'text-white' : 'text-white/30'}`}>
              {tab.label}
            </span>
            {active && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-white rounded-full" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
