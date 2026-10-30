import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'src/content-script/content-script.ts',
      name: 'LazyFill',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
})
