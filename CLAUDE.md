# gmail-catchup

- Stack: React 19 + TypeScript + Vite 7, Express 5 backend.
- Express 5 uses `/{*splat}` instead of `*` for catch-all routes.
- React 19 requires `useRef<T>(undefined)`, not `useRef<T>()`, for mutable refs.
- `NODE_ENV=production` makes Express serve static files from `dist/`.
- Dev: Vite on 5174 proxies `/api` to the backend on 3001; set `FRONTEND_URL` so the OAuth callback redirects to Vite.
