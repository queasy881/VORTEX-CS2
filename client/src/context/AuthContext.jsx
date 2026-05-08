import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { setSession, clearSession, getStoredUser, getRefreshToken } from '../utils/api.js';
import * as authApi from '../api/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [loading, setLoading] = useState(false);

  const handleAuthSuccess = useCallback((data) => {
    setSession({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user,
    });
    setUser(data.user);
  }, []);

  const login = useCallback(async (username, password) => {
    setLoading(true);
    try {
      const data = await authApi.login({ username, password });
      handleAuthSuccess(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, [handleAuthSuccess]);

  const signup = useCallback(async (username, email, password) => {
    setLoading(true);
    try {
      const data = await authApi.signup({ username, email, password });
      handleAuthSuccess(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, [handleAuthSuccess]);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try { await authApi.logout(refreshToken); } catch (_err) {}
    }
    clearSession();
    setUser(null);
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'p2p_user') {
        setUser(getStoredUser());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
