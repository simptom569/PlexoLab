import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Порт 1420 жёстко задан: на него смотрит devUrl в src-tauri/tauri.conf.json
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
