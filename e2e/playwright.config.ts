import { defineConfig, devices } from '@playwright/test';

// Pilote l'app réellement construite (vite build + vite preview) dans un
// vrai navigateur : aucune modification de web/src/main.ts n'est requise
// (contrairement à un pilotage en jsdom, qui exigerait d'exporter son
// routeur privé). Voir docs/parcours-utilisateur.md pour le contexte.
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm --prefix ../web run build && npm --prefix ../web run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
