/** Écran d'entrée du mode démonstration — outil de QA pour #109.
 *
 * Amorce un parcours pré-écrit (un morceau par branche de `recommendedMode`)
 * dans un stockage entièrement séparé de la vraie progression
 * (`sessionStorage`, jamais `localStorage`), pour vérifier visuellement le
 * mode recommandé et l'écran Consigne sans attendre d'avoir vraiment
 * accumulé deux bonnes notes sur un morceau réel. Route cachée
 * (`#/demo`) : aucun bouton nulle part dans l'interface normale.
 */

import { el, ui } from '../dom';
import { seedDemoProgress, stopDemo } from '../store';
import type { Song } from '../types';

export interface DemoContext {
  songs: Song[];
  navigate: (hash: string) => void;
}

const SCENARIOS = [
  {
    titre: 'Nouveau morceau',
    attendu: 'Aucun historique : partition entière, comme aujourd’hui.',
  },
  {
    titre: 'Un seul succès',
    attendu: 'Une seule bonne note : le palier des deux n’est pas atteint, partition entière.',
  },
  {
    titre: 'Deux succès',
    attendu: 'Deux bonnes notes d’affilée (nombre pair) : écran Consigne, partition cachée.',
  },
  {
    titre: 'Trois succès',
    attendu: 'Trois bonnes notes (nombre impair) : l’alternance retombe côté partition entière.',
  },
  {
    titre: 'Again récent',
    attendu:
      'Deux bonnes notes, mais suivies d’un échec : la dernière note prime, partition entière.',
  },
];

function scenarioCard(
  song: Song | undefined,
  scenario: (typeof SCENARIOS)[number],
  navigate: (hash: string) => void,
): HTMLElement {
  if (!song) {
    return el(
      'section',
      { class: `${ui.card} flex flex-col gap-1 opacity-50` },
      el('h2', { class: 'text-base font-medium text-zinc-100' }, scenario.titre),
      el('p', { class: 'text-sm text-zinc-500' }, 'Catalogue trop court pour ce scénario.'),
    );
  }
  const button = el('button', { type: 'button', class: ui.button }, `Ouvrir « ${song.title} »`);
  button.addEventListener('click', () => navigate(`#/song/${song.id}`));
  return el(
    'section',
    { class: `${ui.card} flex flex-col gap-2` },
    el('h2', { class: 'text-base font-medium text-zinc-100' }, scenario.titre),
    el('p', { class: 'text-sm text-zinc-400' }, scenario.attendu),
    button,
  );
}

export function renderDemo(root: HTMLElement, context: DemoContext): () => void {
  seedDemoProgress(context.songs.slice(0, SCENARIOS.length));

  const quitButton = el(
    'button',
    { type: 'button', class: ui.button },
    'Quitter le mode démonstration',
  );
  quitButton.addEventListener('click', () => {
    stopDemo();
    context.navigate('#/');
  });

  root.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8' },
      el(
        'header',
        { class: 'flex flex-col gap-1' },
        el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, 'Mode démonstration'),
        el(
          'p',
          { class: 'text-sm text-zinc-400' },
          'Données de test, isolées de ta vraie progression — jamais lues ni ' +
            'écrites tant que ce mode est actif, effacées à la fermeture de ' +
            'l’onglet. Un morceau par cas de figure du mode recommandé (#109).',
        ),
      ),
      ...SCENARIOS.map((scenario, i) =>
        scenarioCard(context.songs[i], scenario, context.navigate),
      ),
      quitButton,
    ),
  );

  return () => {};
}
