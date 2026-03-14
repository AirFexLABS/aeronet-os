import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': '/src' }
  },
  // Vite handles JSON imports natively — no extra plugin needed.
  // Ensure TypeScript also resolves JSON by setting resolveJsonModule
  // in tsconfig.json (see 7.3).
  server: {
    port: 5173,
    host: true   // Required for Docker — listens on 0.0.0.0
  }
})
