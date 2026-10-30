import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist', emptyOutDir: false,
    lib: { entry: 'src/background.ts', name: 'FormPassFiles', formats: ['iife'], fileName: () => 'background.js' },
  },
})
