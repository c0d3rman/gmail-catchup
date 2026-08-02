import 'dotenv/config';
import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const TOKENS_FILE = join(PROJECT_ROOT, '.tokens.json');
const DIST_DIR = join(PROJECT_ROOT, 'dist');

const PORT = process.env.PORT ?? 3001;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BASE_PATH = (process.env.BASE_PATH ?? '').replace(/\/$/, '');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

const FRONTEND_URL = process.env.FRONTEND_URL || BASE_PATH;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify';
const LEGACY_ACCOUNT_KEY = '__legacy__';

const app = express();
app.use(express.json());

// --- Token storage ---
//
// Shape: { accounts: { "<email>": { refresh_token } }, active: "<email>" }
// Tokens written by older versions ({ refresh_token }) are migrated on read into
// a placeholder account whose real address is resolved on the next refresh.

function readStore() {
  let raw = {};
  if (existsSync(TOKENS_FILE)) {
    try {
      raw = JSON.parse(readFileSync(TOKENS_FILE, 'utf-8'));
    } catch {
      raw = {};
    }
  }

  if (raw.accounts) {
    return { accounts: raw.accounts, active: raw.active ?? Object.keys(raw.accounts)[0] ?? null };
  }

  if (raw.refresh_token) {
    return {
      accounts: { [LEGACY_ACCOUNT_KEY]: { refresh_token: raw.refresh_token } },
      active: LEGACY_ACCOUNT_KEY,
    };
  }

  return { accounts: {}, active: null };
}

function writeStore(store) {
  writeFileSync(TOKENS_FILE, JSON.stringify(store, null, 2));
}

function setAccount(email, refreshToken, { makeActive = true } = {}) {
  const store = readStore();
  store.accounts[email] = { refresh_token: refreshToken };
  if (makeActive || !store.active) store.active = email;
  writeStore(store);
  return store;
}

function removeAccount(email) {
  const store = readStore();
  delete store.accounts[email];
  if (store.active === email) {
    store.active = Object.keys(store.accounts)[0] ?? null;
  }
  writeStore(store);
  return store;
}

// Rename a placeholder account key once we learn the real address
function renameAccount(from, to) {
  const store = readStore();
  const entry = store.accounts[from];
  if (!entry) return store;
  delete store.accounts[from];
  // If the account was already known under its real address, keep the newer token
  store.accounts[to] = entry;
  if (store.active === from) store.active = to;
  writeStore(store);
  return store;
}

async function fetchAccountEmail(accessToken) {
  try {
    const res = await fetch(GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.emailAddress ?? null;
  } catch {
    return null;
  }
}

// Exchange a stored refresh token for an access token.
// Returns { ok: true, accessToken, expiresIn, email } or { ok: false, status, error }.
async function refreshAccount(email) {
  const store = readStore();
  const entry = store.accounts[email];
  if (!entry?.refresh_token) {
    return { ok: false, status: 401, error: 'no_refresh_token' };
  }

  let tokenData;
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: entry.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });
    tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      // If the refresh token is revoked/invalid, drop the account
      if (tokenData.error === 'invalid_grant') removeAccount(email);
      return { ok: false, status: 401, error: tokenData.error ?? 'refresh_failed' };
    }
  } catch (err) {
    console.error('Token refresh error:', err);
    return { ok: false, status: 500, error: 'refresh_failed' };
  }

  let resolvedEmail = email;
  if (email === LEGACY_ACCOUNT_KEY) {
    const realEmail = await fetchAccountEmail(tokenData.access_token);
    if (realEmail) {
      renameAccount(LEGACY_ACCOUNT_KEY, realEmail);
      resolvedEmail = realEmail;
    }
  }

  return {
    ok: true,
    accessToken: tokenData.access_token,
    expiresIn: tokenData.expires_in,
    email: resolvedEmail,
  };
}

// --- Helper to determine redirect URI from request ---

function getRedirectUri(req) {
  const protocol = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('x-forwarded-host') ?? req.get('host');
  return `${protocol}://${host}${BASE_PATH}/api/auth/callback`;
}

// --- Routes ---

// Step 1: Redirect user to Google OAuth
app.get('/api/auth/login', (req, res) => {
  const redirectUri = getRedirectUri(req);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    // select_account lets the user pick which account to sign in as / add
    prompt: 'consent select_account',
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

// Step 2: Handle OAuth callback
app.get('/api/auth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    res.redirect(`${FRONTEND_URL}/#error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code) {
    res.redirect('/#error=missing_code');
    return;
  }

  try {
    const redirectUri = getRedirectUri(req);
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      const msg = tokenData.error_description ?? tokenData.error ?? 'token_exchange_failed';
      res.redirect(`${FRONTEND_URL}/#error=${encodeURIComponent(msg)}`);
      return;
    }

    const email = await fetchAccountEmail(tokenData.access_token);
    if (!email) {
      res.redirect(`${FRONTEND_URL}/#error=${encodeURIComponent('Could not read the Gmail address for this account')}`);
      return;
    }

    // Store refresh token if provided; Google omits it when the account has
    // already granted consent, in which case any existing one stays valid.
    if (tokenData.refresh_token) {
      setAccount(email, tokenData.refresh_token);
    } else {
      const store = readStore();
      if (store.accounts[email]) {
        store.active = email;
        writeStore(store);
      } else {
        res.redirect(`${FRONTEND_URL}/#error=${encodeURIComponent('No refresh token returned; try removing the app from your Google account permissions and signing in again')}`);
        return;
      }
    }

    const hash = new URLSearchParams({
      access_token: tokenData.access_token,
      expires_in: String(tokenData.expires_in),
      email,
    });
    res.redirect(`${FRONTEND_URL}/#${hash}`);
  } catch (err) {
    console.error('Token exchange error:', err);
    res.redirect('/#error=token_exchange_failed');
  }
});

// Step 3: Refresh access token for the active (or requested) account
app.post('/api/auth/refresh', async (req, res) => {
  const store = readStore();
  const email = req.body?.email ?? store.active;
  if (!email) {
    res.status(401).json({ error: 'no_refresh_token' });
    return;
  }

  const result = await refreshAccount(email);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.json({
    access_token: result.accessToken,
    expires_in: result.expiresIn,
    email: result.email,
  });
});

// List known accounts
app.get('/api/auth/accounts', (_req, res) => {
  const store = readStore();
  res.json({ accounts: Object.keys(store.accounts), active: store.active });
});

// Switch the active account and return an access token for it
app.post('/api/auth/switch', async (req, res) => {
  const { email } = req.body ?? {};
  const store = readStore();
  if (!email || !store.accounts[email]) {
    res.status(404).json({ error: 'unknown_account' });
    return;
  }

  const result = await refreshAccount(email);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const updated = readStore();
  updated.active = result.email;
  writeStore(updated);

  res.json({
    access_token: result.accessToken,
    expires_in: result.expiresIn,
    email: result.email,
  });
});

// Step 4: Logout - remove one account (default: the active one) or all of them
app.post('/api/auth/logout', async (req, res) => {
  const { email, all } = req.body ?? {};
  const store = readStore();

  const targets = all ? Object.keys(store.accounts) : [email ?? store.active].filter(Boolean);

  for (const target of targets) {
    const refreshToken = store.accounts[target]?.refresh_token;
    if (refreshToken) {
      // Best effort: revoke so the next sign-in issues a fresh refresh token
      try {
        await fetch(GOOGLE_REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken }),
        });
      } catch {
        // Ignore - we still drop the token locally
      }
    }
    removeAccount(target);
  }

  const remaining = readStore();
  res.json({ ok: true, accounts: Object.keys(remaining.accounts), active: remaining.active });
});

// Production: serve static files
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(DIST_DIR));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(join(DIST_DIR, 'index.html'));
  });
}

const HOST = process.env.HOST ?? '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
