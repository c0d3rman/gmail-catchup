# Gmail Catch Up

Swipe through your unread emails like a card deck. Right to archive, left to skip, down to save for later.

## Setup

### 1. Google Cloud credentials

1. Go to [Google Cloud Console > Credentials](https://console.cloud.google.com/apis/credentials)
2. Create a project (or select an existing one)
3. Enable the **Gmail API** for the project
4. Go to **OAuth consent screen** and configure it (External is fine for personal use, just add yourself as a test user)
5. Go to **Credentials** > **Create Credentials** > **OAuth 2.0 Client ID**
6. Application type: **Web application**
7. Under **Authorized redirect URIs**, add: `http://localhost:3001/api/auth/callback`
8. Copy the **Client ID** and **Client Secret**

### 2. Environment

```sh
cp .env.example .env
```

Fill in your Client ID and Client Secret in `.env`.

### 3. Install and run

```sh
npm install

# Terminal 1 - backend (handles OAuth + token refresh)
npm run server

# Terminal 2 - frontend (Vite dev server)
npm run dev
```

Open http://localhost:5174 and click "Sign in with Google".

### Production

```sh
npm run build
npm start
```

This serves the built frontend from the Express server on port 3001.
