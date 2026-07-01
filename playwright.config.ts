import { defineConfig, devices } from '@playwright/test'

/**
 * E2E-тесты M Glass App.
 * Запуск: `npm run e2e` (поднимет `next dev` автоматически).
 * Vitest-юниты живут в __tests__/ и сюда не попадают.
 */
const PORT = Number(process.env.PORT ?? 3000)
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  /* Сам поднимает dev-сервер перед тестами и переиспользует уже запущенный локально. */
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
