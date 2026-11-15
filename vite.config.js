import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1800,
    rollupOptions: { output: { manualChunks: { three: ['three'], r3f: ['@react-three/fiber', '@react-three/drei'], react: ['react', 'react-dom'] } } },
  },
  test: { include: ['tests/**/*.test.js'], exclude: ['tests/debug/**'] },
});
