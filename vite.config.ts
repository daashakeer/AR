import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    // Note: WebXR requires HTTPS in production.
    // For local dev, localhost is exempt from this requirement.
    // When deploying to Cloudflare Pages / Vercel / Netlify,
    // HTTPS is provided automatically.
  },
})
