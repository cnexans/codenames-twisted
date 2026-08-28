import { defineConfig, devices } from '@playwright/test';

/**
 * Por defecto apunta a producción: la gracia de esta prueba es abrir varios
 * navegadores de verdad contra el servidor real y comprobar que la partida
 * funciona de punta a punta.
 *
 *   npm run e2e                                   # contra codenames.cnexans.com
 *   E2E_URL=http://localhost:3000 npm run e2e     # contra tu servidor local
 */
export default defineConfig({
  testDir: './test/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,   // cada prueba crea salas reales; mejor una a la vez
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL || 'https://codenames.cnexans.com',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
