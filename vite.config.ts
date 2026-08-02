import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env so BASE_PATH applies without having to set it on the build command
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }

  return {
    base: env.BASE_PATH ?? '/',
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        '/api': 'http://localhost:3001',
      },
    },
  }
})
