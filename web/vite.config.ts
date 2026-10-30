import { defineConfig } from 'vite';

// GitHub Pages では https://<user>.github.io/flytown/ で配信する。
export default defineConfig({
  base: '/flytown/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  server: { host: true },
});
