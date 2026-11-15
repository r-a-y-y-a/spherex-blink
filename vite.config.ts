import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    // `vercel dev` serves /api locally; plain `vite` proxies to it. Set API_PROXY to use another
    // API, e.g. API_PROXY=https://blinkx-nasa.vercel.app to test against production's data speed.
    proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:3000', changeOrigin: true } },
  },
})
