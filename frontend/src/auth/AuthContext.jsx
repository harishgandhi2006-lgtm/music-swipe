import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { setUnauthorizedHandler } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem('ms_token');
    const savedUser = localStorage.getItem('ms_user');
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('ms_token');
        localStorage.removeItem('ms_user');
      }
    }
    setLoading(false);
  }, []);

  // Let api.js tear down the session when the server rejects our token. Without
  // this an expired token leaves every view rendering an empty state, which
  // reads as "the app is broken" rather than "log back in".
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      setSessionExpired(true);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback((newToken, newUser) => {
    localStorage.setItem('ms_token', newToken);
    localStorage.setItem('ms_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    setSessionExpired(false);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('ms_token');
    localStorage.removeItem('ms_user');
    setToken(null);
    setUser(null);
    setSessionExpired(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, sessionExpired }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
