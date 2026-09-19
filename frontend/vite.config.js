import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies /api to uvicorn, so the browser sees one origin and
// CORS never comes into it during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
