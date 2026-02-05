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

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? '';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify';

const app = express();
app.use(express.json());

// --- Token storage ---

function readTokens() {
  if (!existsSync(TOKENS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(TOKENS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeTokens(tokens) {
  writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

// --- Helper to determine redirect URI from request ---

function getRedirectUri(req) {
  const protocol = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('x-forwarded-host') ?? req.get('host');
  return `${protocol}://${host}/api/auth/callback`;
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
    prompt: 'consent',
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

    // Store refresh token if provided
    if (tokenData.refresh_token) {
      const tokens = readTokens();
      tokens.refresh_token = tokenData.refresh_token;
      writeTokens(tokens);
    }

    const hash = new URLSearchParams({
      access_token: tokenData.access_token,
      expires_in: String(tokenData.expires_in),
    });
    res.redirect(`${FRONTEND_URL}/#${hash}`);
  } catch (err) {
    console.error('Token exchange error:', err);
    res.redirect('/#error=token_exchange_failed');
  }
});

// Step 3: Refresh access token using stored refresh token
app.post('/api/auth/refresh', async (_req, res) => {
  const tokens = readTokens();
  if (!tokens.refresh_token) {
    res.status(401).json({ error: 'no_refresh_token' });
    return;
  }

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: tokens.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      // If refresh token is revoked/invalid, clean up
      if (tokenData.error === 'invalid_grant') {
        writeTokens({});
      }
      res.status(401).json({ error: tokenData.error ?? 'refresh_failed' });
      return;
    }

    res.json({
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in,
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'refresh_failed' });
  }
});

// Step 4: Logout - clear stored refresh token
app.post('/api/auth/logout', (_req, res) => {
  writeTokens({});
  res.json({ ok: true });
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
