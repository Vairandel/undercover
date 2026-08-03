import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, Vite serves the UI on 5173 and proxies the realtime + API traffic to
// the game server on 3000. In production everything is served by the server on
// a single port, which is what makes the "one IP on the wifi" story work.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000' },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
