import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Порт 1420 жёстко задан: на него смотрит devUrl в src-tauri/tauri.conf.json
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
