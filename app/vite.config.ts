import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Версия приложения одна, в src-tauri/tauri.conf.json; клиент показывает её в «Настройки → О программе»
const { version } = JSON.parse(readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as { version: string }

// Порт 1420 жёстко задан: на него смотрит devUrl в src-tauri/tauri.conf.json
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
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
