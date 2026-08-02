import { useState, useCallback, useEffect, useRef } from 'react';
import { clearPersistedState } from './usePersistedState';

interface AuthState {
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  userEmail: string | null;
  accounts: string[];
}

const REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50 minutes
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function parseHashParams(): { accessToken: string; expiresIn: number; email: string | null } | null {
  const hash = window.location.hash;
  if (!hash.includes('access_token')) return null;

  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get('access_token');
  const expiresIn = params.get('expires_in');

  if (accessToken && expiresIn) {
    window.history.replaceState(null, '', window.location.pathname);
    return { accessToken, expiresIn: parseInt(expiresIn), email: params.get('email') };
  }
  return null;
}

function parseHashError(): string | null {
  const hash = window.location.hash;
  if (!hash.includes('error')) return null;

  const params = new URLSearchParams(hash.substring(1));
  const error = params.get('error_description') ?? params.get('error');
  window.history.replaceState(null, '', window.location.pathname);
  return error ?? 'Authentication failed';
}

const SIGNED_OUT: AuthState = {
  accessToken: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  userEmail: null,
  accounts: [],
};

export function useGoogleAuth() {
  const [authState, setAuthState] = useState<AuthState>(() => {
    // Check URL hash for callback token
    const tokenFromHash = parseHashParams();
    if (tokenFromHash) {
      return {
        ...SIGNED_OUT,
        accessToken: tokenFromHash.accessToken,
        isAuthenticated: true,
        userEmail: tokenFromHash.email,
      };
    }

    // Check URL hash for error
    const hashError = parseHashError();
    if (hashError) {
      return { ...SIGNED_OUT, error: hashError };
    }

    // Will attempt refresh on mount
    return { ...SIGNED_OUT, isLoading: true };
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/accounts`);
      if (!res.ok) return;
      const data = await res.json();
      setAuthState(prev => ({ ...prev, accounts: data.accounts ?? [] }));
    } catch {
      // Non-fatal - the switcher just shows the current account
    }
  }, []);

  // Attempt to refresh access token via backend
  const refreshToken = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) return false;

      const data = await res.json();
      setAuthState(prev => ({
        ...prev,
        accessToken: data.access_token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        userEmail: data.email ?? prev.userEmail,
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  // On mount: if we don't already have a token from the hash, try refreshing
  useEffect(() => {
    const finish = () => loadAccounts();

    if (authState.accessToken) {
      // Already have a token from the hash
      finish();
      return;
    }

    refreshToken().then(success => {
      if (success) {
        finish();
      } else {
        setAuthState(prev => ({ ...prev, isLoading: false }));
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic refresh timer
  useEffect(() => {
    if (!authState.isAuthenticated) {
      clearTimeout(refreshTimerRef.current);
      return;
    }

    const scheduleRefresh = () => {
      refreshTimerRef.current = setTimeout(async () => {
        const success = await refreshToken();
        if (success) {
          scheduleRefresh();
        } else {
          setAuthState({ ...SIGNED_OUT, error: 'Session expired. Please sign in again.' });
        }
      }, REFRESH_INTERVAL_MS);
    };

    scheduleRefresh();
    return () => clearTimeout(refreshTimerRef.current);
  }, [authState.isAuthenticated, authState.userEmail, refreshToken]);

  const signIn = useCallback(() => {
    window.location.href = `${API_BASE}/api/auth/login`;
  }, []);

  // Adding an account uses the same flow - Google prompts for account selection
  const addAccount = signIn;

  const switchAccount = useCallback(async (email: string) => {
    setAuthState(prev => (prev.userEmail === email ? prev : { ...prev, isLoading: true }));
    try {
      const res = await fetch(`${API_BASE}/api/auth/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        setAuthState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Could not switch to that account. Please sign in again.',
        }));
        await loadAccounts();
        return;
      }
      const data = await res.json();
      setAuthState(prev => ({
        ...prev,
        accessToken: data.access_token,
        userEmail: data.email ?? email,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      }));
    } catch {
      setAuthState(prev => ({ ...prev, isLoading: false, error: 'Could not switch accounts' }));
    }
  }, [loadAccounts]);

  const signOut = useCallback(async () => {
    const current = authState.userEmail;
    let remaining: string[] = [];
    let nextActive: string | null = null;

    // Drop the signed-out account's cached emails so they can't reappear
    if (current) await clearPersistedState(current);

    try {
      const res = await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current ? { email: current } : {}),
      });
      if (res.ok) {
        const data = await res.json();
        remaining = data.accounts ?? [];
        nextActive = data.active ?? null;
      }
    } catch {
      // Continue with local sign out even if backend call fails
    }

    if (nextActive) {
      setAuthState(prev => ({ ...prev, accounts: remaining, isLoading: true }));
      await switchAccount(nextActive);
      setAuthState(prev => ({ ...prev, accounts: remaining }));
      return;
    }

    setAuthState(SIGNED_OUT);
  }, [authState.userEmail, switchAccount]);

  return {
    ...authState,
    signIn,
    signOut,
    addAccount,
    switchAccount,
  };
}
