import { defineConfig, devices } from '@playwright/test'
import { MAX_DIFF_RATIO } from './tolerance'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: './output',
  snapshotPathTemplate: '{testDir}/snapshots/{testFileName}/{arg}-{platform}{ext}',
  // тесты работают с одной общей тестовой базой, поэтому идут по одному
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:1420',
    locale: 'ru-RU',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      // Эталонные снимки сделаны в окне 1440×900
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: MAX_DIFF_RATIO } },
  webServer: [
    {
      // сервер с отдельной базой plexolab_e2e (данные макета), порт 8099
      command: 'node scripts/e2e-server.mjs',
      url: 'http://127.0.0.1:8099/healthz',
      reuseExistingServer: true,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm --prefix ../../app run dev',
      url: 'http://localhost:1420',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
