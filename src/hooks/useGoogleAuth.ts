import { useState, useCallback, useEffect } from 'react';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
].join(' ');

interface AuthState {
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  userEmail: string | null;
}

const CLIENT_ID_KEY = 'gmail_catchup_client_id';
const TOKEN_KEY = 'gmail_catchup_token';
const TOKEN_EXPIRY_KEY = 'gmail_catchup_token_expiry';
const USER_EMAIL_KEY = 'gmail_catchup_user_email';

function getInitialAuthState(): AuthState {
  // Check URL hash first (OAuth callback)
  const hash = window.location.hash;
  if (hash.includes('access_token')) {
    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get('access_token');
    const expiresIn = params.get('expires_in');

    if (accessToken && expiresIn) {
      const expiryTime = Date.now() + parseInt(expiresIn) * 1000;
      localStorage.setItem(TOKEN_KEY, accessToken);
      localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());
      window.history.replaceState(null, '', window.location.pathname);

      return {
        accessToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        userEmail: localStorage.getItem(USER_EMAIL_KEY),
      };
    }
  }

  // Check localStorage for existing token
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  const email = localStorage.getItem(USER_EMAIL_KEY);

  if (token && expiry && Date.now() < parseInt(expiry)) {
    return {
      accessToken: token,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      userEmail: email,
    };
  }

  return {
    accessToken: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    userEmail: null,
  };
}

export function useGoogleAuth() {
  const [clientId, setClientId] = useState<string>(() => {
    return localStorage.getItem(CLIENT_ID_KEY) ?? '';
  });

  const [authState, setAuthState] = useState<AuthState>(getInitialAuthState);

  const saveClientId = useCallback((id: string) => {
    localStorage.setItem(CLIENT_ID_KEY, id);
    setClientId(id);
  }, []);

  const signIn = useCallback(() => {
    if (!clientId) {
      setAuthState(prev => ({ ...prev, error: 'Please enter your Google Client ID' }));
      return;
    }

    const redirectUri = window.location.origin + window.location.pathname;
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');

    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', GMAIL_SCOPES);
    authUrl.searchParams.set('prompt', 'consent');

    window.location.href = authUrl.toString();
  }, [clientId]);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    localStorage.removeItem(USER_EMAIL_KEY);

    setAuthState({
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      userEmail: null,
    });
  }, []);

  // Fetch user email if authenticated but email not yet loaded
  useEffect(() => {
    if (authState.isAuthenticated && authState.accessToken && !authState.userEmail) {
      fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${authState.accessToken}` },
      })
        .then(res => res.json())
        .then(data => {
          if (data.email) {
            localStorage.setItem(USER_EMAIL_KEY, data.email);
            setAuthState(prev => ({ ...prev, userEmail: data.email }));
          }
        })
        .catch(() => {
          // Silently fail - email is optional
        });
    }
  }, [authState.isAuthenticated, authState.accessToken, authState.userEmail]);

  // Handle error in URL hash
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('error')) {
      const params = new URLSearchParams(hash.substring(1));
      const error = params.get('error_description') ?? params.get('error');

      setAuthState(prev => ({
        ...prev,
        error: error ?? 'Authentication failed',
      }));

      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  return {
    ...authState,
    clientId,
    saveClientId,
    signIn,
    signOut,
    hasClientId: Boolean(clientId),
  };
}
