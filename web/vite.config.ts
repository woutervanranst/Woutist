import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        // MSAL v5 redirect bridge page (see src/auth/redirectBridge.ts).
        redirect: resolve(import.meta.dirname, 'redirect.html'),
      },
    },
  },
  server: {
    // Must match the SPA redirect URIs registered in Entra (see docs/entra-app-registration.md).
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
