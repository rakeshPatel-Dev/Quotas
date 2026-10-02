import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  // Relative base so the built bundle loads from the filesystem in the packaged
  // app as well as from the dev server.
  base: './',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome128',
  },
  server: {
    port: 5273,
    strictPort: true,
  },
})
