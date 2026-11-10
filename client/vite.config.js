import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['src/**/*.test.{js,jsx}', 'test/**/*.test.{js,jsx}'],
  },
});
