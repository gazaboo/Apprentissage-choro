import { defineConfig } from 'vitest/config';

// Fichier séparé de `vite.config.ts` : y ajouter une clé `test` ferait
// recharger le plugin Tailwind à chaque run de test (cf. CLAUDE.md).
export default defineConfig({
  test: {
    css: false,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.unit.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.dom.test.ts'],
          setupFiles: ['test/setup.dom.ts'],
        },
      },
    ],
  },
});
