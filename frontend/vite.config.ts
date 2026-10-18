import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Where the .env files live: next to this file, wherever vite is started from.
const ENV_DIR = fileURLToPath(new URL('.', import.meta.url))

// The dev server proxies /api to uvicorn, so the browser sees one origin and
// CORS never comes into it during development.
export default defineConfig(({ mode }) => {
  // Vite reads .env files for the bundle only, after this config has run, so
  // the proxy has to load them itself. The shell still wins over the files,
  // which is how playwright.config.ts points the proxy at its own API.
  const env = loadEnv(mode, ENV_DIR, '')

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
          // With nothing listening there, Vite's own handler answers 500,
          // which reads as a fault in the API rather than an API that is not
          // running. A 502 is what nginx and Traefik say in its place. This
          // handler runs before Vite's, which still logs the error but leaves
          // an answer already sent alone.
          configure: (proxy) => {
            proxy.on('error', (_error, _request, response) => {
              if ('writeHead' in response && !response.headersSent) response.writeHead(502).end()
            })
          },
        },
      },
    },
    test: {
      // Components need a DOM; the pure modules do not care either way.
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}', 'vite-proxy.test.ts'],
      setupFiles: ['src/test-setup.ts'],
      // Spies and stubs are undone between tests rather than by hand.
      restoreMocks: true,
      unstubGlobals: true,
      unstubEnvs: true,
    },
  }
})
