import { defineConfig, devices } from '@playwright/test'
import { MAX_DIFF_RATIO } from './tolerance'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: './output',
  snapshotPathTemplate: '{testDir}/snapshots/{testFileName}/{arg}-{platform}{ext}',
  fullyParallel: true,
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
  webServer: {
    command: 'npm --prefix ../../app run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
