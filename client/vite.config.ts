import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The MVP is fully client-side: progress is saved in the browser, so there is no API to proxy.
// `base: './'` lets the built game be opened from any static host or sub-folder (e.g. a hackathon page).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
});
