import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :3001; proxying keeps everything same-origin so the
// SameSite=Strict refresh cookie works exactly as it does in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/v1': { target: 'http://localhost:3001', changeOrigin: false } },
  },
});
