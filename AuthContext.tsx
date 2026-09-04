import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User } from '@/types';
import { apiClient } from '@/api/client';

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'brand_marketing_admin'
  | 'brand_market_admin'
  | 'brand_marketing_user'
  | 'brand_market_user'
  | 'trademark_admin'
  | 'trademark_user';


interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: () => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  // Role helpers
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isBrandMarketingAdmin: boolean;
  isBrandMarketingUser: boolean;
  isTrademarkAdmin: boolean;
  isTrademarkUser: boolean;
  canAccessDashboard: boolean;
  canAccessReports: boolean;
  canAccessUserManagement: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Wipe all per-user UI caches (generated names, analysis, compare, last query…)
// so one user's session never carries over to the next on the same browser.
// Was previously clearing sessionStorage, but every actual write across this
// app (pharma_gen_form, pharma_gen_results, pharma_last_query,
// pharma_active_case_id, pharma_compare_names, pharma_brand_suggestions) uses
// localStorage — sessionStorage is never written to anywhere, so this was a
// manage those explicitly themselves, immediately before/after this call.
function clearUserCache() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('pharma_'))
      .forEach(k => localStorage.removeItem(k));
  } catch {
    /* localStorage unavailable — nothing to clear */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // H-01: Verify session via HttpOnly cookies and establish in-memory bearer token
    async function initAuth() {
      try {
        try {
          const ref = await apiClient.refreshToken();
          apiClient.setToken(ref.access_token);
          setToken(ref.access_token);
          setUser(ref.user);
                    return;
        } catch {
          // If refresh token fails, try /auth/me with access cookie
          const me = await apiClient.getMe();
          setUser(me);
          setToken('cookie_authenticated');
                    return;
        }
      } catch {
        setUser(null);
        setToken(null);
        apiClient.setToken(null);
              } finally {
        setIsLoading(false);
      }
    }
    initAuth();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    clearUserCache();
    const result = await apiClient.login(email, password);
    apiClient.setToken(result.access_token);
    setToken(result.access_token);
    setUser(result.user);
      }, []);

  const loginWithToken = useCallback(async () => {
    clearUserCache();
    const me = await apiClient.getMe();
    setUser(me);
        return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.logout();
    } catch {
      /* ignore */
    }
    apiClient.setToken(null);
    setUser(null);
    setToken(null);
        clearUserCache();
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await apiClient.getMe();
      setUser(me);
          } catch {
      /* ignore */
    }
  }, []);

  // Compute granular role flags for the 6 roles
  const role = (user?.role || '').toLowerCase();
  const isSuperAdmin = !!user?.is_superuser || role === 'super_admin';
  const isAdmin = isSuperAdmin || role === 'admin';
  const isBrandMarketingAdmin = role === 'brand_marketing_admin' || role === 'brand_market_admin';
  const isBrandMarketingUser = role === 'brand_marketing_user' || role === 'brand_market_user' || role === 'business_team';
  const isTrademarkAdmin = role === 'trademark_admin';
  const isTrademarkUser = role === 'trademark_user' || role === 'trademark_team';

  // Page access capabilities
  const canAccessDashboard = isSuperAdmin || isAdmin || isBrandMarketingAdmin || isTrademarkAdmin;
  const canAccessReports = isSuperAdmin || isAdmin || isBrandMarketingAdmin || isTrademarkAdmin;
  const canAccessUserManagement = isSuperAdmin;


  return (
    <AuthContext.Provider value={{
      user, token,
      isAuthenticated: !!(token || user),
      isLoading,
      login, loginWithToken, logout, refreshUser,
      isSuperAdmin,
      isAdmin,
      isBrandMarketingAdmin,
      isBrandMarketingUser,
      isTrademarkAdmin,
      isTrademarkUser,
      canAccessDashboard,
      canAccessReports,
      canAccessUserManagement,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
