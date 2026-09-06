import { defineConfig } from 'vite'
export default defineConfig({
  server: { proxy: { '/ws': { target: 'ws://localhost:30300', ws:true } } },
  build: { outDir: 'dist' }
})
