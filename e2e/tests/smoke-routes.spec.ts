import { expect, test } from '@playwright/test';
import { seedProgress } from '../fixtures/progress';
import { runJourney } from '../fixtures/journey';
import { stubYouTube } from '../fixtures/yt-stub';

/**
 * Parcourt chaque route directement chargeable par URL — `#/session`,
 * `#/filage/run` et `#/technique/run` exigent un état en mémoire posé par un
 * clic (pas juste le hash), donc hors périmètre ici : voir
 * `session-deep.spec.ts` pour `#/session`.
 */
test('chaque route directe rend sans erreur console', async ({ page }) => {
  await stubYouTube(page);
  await seedProgress(page);

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const manifest = (await (await page.request.get('/data/manifest.json')).json()) as Array<{
    id: string;
    title: string;
  }>;
  const song = manifest[0]!;

  await runJourney(page, [
    { goto: '#/' },
    { expectText: 'Répertoire de choros' },
    { goto: '#/compte' },
    { expectText: 'Vous travaillez sur cet appareil uniquement.' },
    { goto: '#/aide' },
    { expectText: 'Comment ça marche' },
    { goto: '#/filage' },
    { expectText: 'Préparer le filage' },
    { goto: `#/song/${song.id}` },
    { expectText: song.title },
  ]);

  expect(consoleErrors).toEqual([]);
});
