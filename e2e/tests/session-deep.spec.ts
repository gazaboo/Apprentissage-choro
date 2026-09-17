import { test } from '@playwright/test';
import { defaultProgress, seedProgress } from '../fixtures/progress';
import { runJourney } from '../fixtures/journey';
import { stubYouTube } from '../fixtures/yt-stub';

/**
 * Dashboard → « travail de fond » sur tout le répertoire (pas de setlist
 * active, pool = tout le catalogue) → traverse 2 morceaux en passant
 * l'évaluation SRS → arrête la séance → résumé → retour dashboard.
 *
 * Note : dans une session en cours (`context.session` posé par `trainer.ts`),
 * le bouton d'avancement d'une séance « deep » porte le libellé
 * « Passer au morceau suivant » — « Terminer et évaluer » n'apparaît qu'en
 * entraînement libre, hors séance (`#/song/:id`).
 */
test('travail de fond : dashboard → session → 2 morceaux → résumé → dashboard', async ({
  page,
}) => {
  await stubYouTube(page);
  await seedProgress(page, defaultProgress({ activeSetlistId: null, setlists: [] }));

  await runJourney(page, [
    { goto: '#/' },
    { click: 'Parcourir tout le répertoire' },
    { expectRoute: '#/session' },

    { click: 'Passer au morceau suivant' },
    { waitForVisible: '[role="dialog"][aria-modal="true"]' },
    { click: 'Passer' },

    { click: 'Passer au morceau suivant' },
    { waitForVisible: '[role="dialog"][aria-modal="true"]' },
    { click: 'Passer' },

    { click: 'Terminer la séance' },
    { waitForVisible: '[role="dialog"][aria-modal="true"]' },
    { click: 'Passer' },

    { expectText: 'Séance terminée' },
    { click: 'Retour au répertoire' },
    { expectRoute: '#/' },
  ]);
});
