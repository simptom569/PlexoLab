import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Снимки и GIF для README: тот же стенд, что у визуальных тестов (сервер с данными макета, клиент в Chromium 1440×900),
// но отдельные файлы `media/*.media.ts`, которые обычный `npm run test-visual` не подхватывает.
export default defineConfig({
  ...base,
  testMatch: 'media/*.media.ts',
  outputDir: './output/media',
})
