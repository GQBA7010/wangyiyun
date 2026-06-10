import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build output goes straight into the backend's static dir so a single
// Node process serves both API and UI in production (BaoTa friendly).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
