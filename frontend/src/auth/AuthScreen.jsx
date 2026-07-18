import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from './AuthContext.jsx';

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, sessionExpired } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong'); return; }
      login(data.token, data.user);
    } catch {
      setError('Network error — is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  function switchMode(m) {
    setMode(m);
    setError('');
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen px-6 gap-8 max-w-sm mx-auto">
      {/* Logo */}
      <motion.div
        className="text-center"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="text-6xl mb-4">🎵</div>
        <h1 className="text-white font-bold text-3xl tracking-tight">Music Swipe</h1>
        <p className="text-white/40 text-sm mt-2">Discover music · Connect with friends</p>
      </motion.div>

      <motion.div
        className="w-full"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        {/* Explain an involuntary logout, so it doesn't read as a bug */}
        {sessionExpired && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-amber-400/10 border border-amber-400/20">
            <p className="text-amber-300/90 text-xs font-medium">
              Your session expired — sign in again to pick up where you left off.
            </p>
          </div>
        )}

        {/* Mode tabs. These are the only controls named "Sign In"/"Sign Up" —
            the form's submit says "Continue" so nothing shares an accessible
            name with them. type="button" keeps them inert if they ever end up
            inside the form. */}
        <div role="tablist" aria-label="Authentication mode" className="flex bg-white/5 rounded-xl p-1 mb-5">
          {[['login', 'Sign In'], ['register', 'Sign Up']].map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
                mode === m ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="username"
            className="w-full bg-white/10 text-white placeholder-white/30 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-white/30 text-sm"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="w-full bg-white/10 text-white placeholder-white/30 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-white/30 text-sm"
          />

          {error && (
            <motion.p
              className="text-red-400 text-xs text-center"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            data-testid="auth-submit"
            disabled={loading || !username || !password}
            className="bg-white text-black font-bold py-3 rounded-xl mt-1 hover:bg-white/90 active:scale-95 transition-all disabled:opacity-40 disabled:scale-100"
          >
            {loading ? '...' : 'Continue'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
