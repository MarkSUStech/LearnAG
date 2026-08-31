import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  worker: {
    // pdf.js worker 以 ESM 引入，必须用 es 格式打包
    format: 'es',
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
})
