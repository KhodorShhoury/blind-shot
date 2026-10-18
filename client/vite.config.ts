import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared/src') } },
  server: { host: true, port: 5173 },
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 400, rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom'], socket: ['socket.io-client'] } } } },
});
