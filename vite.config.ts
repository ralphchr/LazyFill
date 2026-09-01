import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/popup/popup.tsx'),
        content: path.resolve(__dirname, 'src/content-script/content-script.ts'),
        background: path.resolve(__dirname, 'src/background/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]_[hash].js',
        assetFileNames: 'assets/[name]_[hash][extname]',
      },
    },
    outDir: 'dist',
    emptyOutDir: false,
  },
})
