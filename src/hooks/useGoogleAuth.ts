import { useState, useCallback, useEffect, useRef } from 'react';

interface AuthState {
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  userEmail: string | null;
}

const REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50 minutes
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function parseHashParams(): { accessToken: string; expiresIn: number } | null {
  const hash = window.location.hash;
  if (!hash.includes('access_token')) return null;

  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get('access_token');
  const expiresIn = params.get('expires_in');

  if (accessToken && expiresIn) {
    window.history.replaceState(null, '', window.location.pathname);
    return { accessToken, expiresIn: parseInt(expiresIn) };
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

export function useGoogleAuth() {
  const [authState, setAuthState] = useState<AuthState>(() => {
    // Check URL hash for callback token
    const tokenFromHash = parseHashParams();
    if (tokenFromHash) {
      return {
        accessToken: tokenFromHash.accessToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        userEmail: null,
      };
    }

    // Check URL hash for error
    const hashError = parseHashError();
    if (hashError) {
      return {
        accessToken: null,
        isAuthenticated: false,
        isLoading: false,
        error: hashError,
        userEmail: null,
      };
    }

    // Will attempt refresh on mount
    return {
      accessToken: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,
      userEmail: null,
    };
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Attempt to refresh access token via backend
  const refreshToken = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST' });
      if (!res.ok) return false;

      const data = await res.json();
      setAuthState(prev => ({
        ...prev,
        accessToken: data.access_token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  // On mount: if we don't already have a token from the hash, try refreshing
  useEffect(() => {
    if (authState.accessToken) return; // Already have token from hash

    refreshToken().then(success => {
      if (!success) {
        setAuthState(prev => ({
          ...prev,
          isLoading: false,
        }));
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
          setAuthState({
            accessToken: null,
            isAuthenticated: false,
            isLoading: false,
            error: 'Session expired. Please sign in again.',
            userEmail: null,
          });
        }
      }, REFRESH_INTERVAL_MS);
    };

    scheduleRefresh();
    return () => clearTimeout(refreshTimerRef.current);
  }, [authState.isAuthenticated, refreshToken]);

  // Fetch user email when authenticated
  useEffect(() => {
    if (!authState.isAuthenticated || !authState.accessToken || authState.userEmail) return;

    fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${authState.accessToken}` },
    })
      .then(res => res.json())
      .then(data => {
        if (data.email) {
          setAuthState(prev => ({ ...prev, userEmail: data.email }));
        }
      })
      .catch(() => {
        // Silently fail - email is optional
      });
  }, [authState.isAuthenticated, authState.accessToken, authState.userEmail]);

  const signIn = useCallback(() => {
    window.location.href = `${API_BASE}/api/auth/login`;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
    } catch {
      // Continue with local sign out even if backend call fails
    }
    setAuthState({
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      userEmail: null,
    });
  }, []);

  return {
    ...authState,
    signIn,
    signOut,
  };
}
