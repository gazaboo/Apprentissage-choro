/** Page « Comment ça marche » — les principes de mémorisation derrière l'app.
 *
 * Vue statique, à destination de l'utilisateur (pas des développeurs) : elle
 * explique, avec des sources réelles de sciences cognitives, à quel
 * mécanisme de l'app correspond chaque principe. Contrairement aux réglages
 * de l'UI — où le vocabulaire de conception reste en langue courante — cette
 * page a pour rôle de le nommer et de le sourcer.
 */

import { el, ui } from '../dom';


interface Principe {
  titre: string;
  resume: string;
  application: string;
  sources: string;
}

const PRINCIPES: Principe[] = [
  {
    titre: 'Se rappeler plutôt que relire (retrieval practice)',
    resume:
      'Se forcer à retrouver une information de mémoire la fixe bien mieux que ' +
      'de la relire encore une fois : l’effort de rappel est ce qui consolide.',
    application:
      'C’est le principe des mesures cachées, des éclipses et du mode ' +
      '« Sans partition » : la partition se dérobe pour vous obliger à ' +
      'reconstruire, pas à relire.',
    sources:
      'Roediger & Karpicke (2006), The Power of Testing Memory · Karpicke & ' +
      'Roediger (2008), The Critical Importance of Retrieval for Learning',
  },
  {
    titre: 'Des points de reprise (performance cues)',
    resume:
      'Un repère bref, retrouvé au bon moment, rattrape une mémoire qui lâche ' +
      'sans faire retomber dans la lecture passive.',
    application:
      'C’est pourquoi les débuts de système restent visibles plus souvent ' +
      'en mode Mesures cachées, et pourquoi le nom d’une note reste ' +
      'disponible comme indice ponctuel en arpèges.',
    sources: 'Bjork & Bjork (2011), les « desirable difficulties »',
  },
  {
    titre: 'Alterner plutôt que bloquer (interleaving)',
    resume:
      'Travailler plusieurs morceaux entremêlés, plutôt qu’un seul du début ' +
      'à la fin, oblige à retrouver le bon geste au bon moment — la vraie ' +
      'difficulté d’un vrai répertoire.',
    application:
      'La Session du jour (Travail de fond, Révision des urgences) enchaîne ' +
      'ainsi les morceaux de la setlist plutôt que de les isoler un par un.',
    sources: 'Rohrer & Taylor (2007), The shuffling of mathematics problems improves learning',
  },
  {
    titre: 'Démarrer à froid',
    resume:
      'Reprendre un morceau sans préparation, comme en situation de concert, ' +
      'entraîne la mémoire dans les conditions où elle devra vraiment servir.',
    application:
      'C’est le rôle de « Reprendre au hasard » (décompte puis lecture ' +
      'immédiate) et du filage, qui enchaîne la setlist dans son ordre de ' +
      'concert sans temps de chauffe.',
    sources:
      'Un cas particulier des « desirable difficulties » (Bjork & Bjork, 2011) : ' +
      'reproduire la difficulté réelle de la scène plutôt que de s’en protéger.',
  },
  {
    titre: 'Réviser juste avant d’oublier (répétition espacée)',
    resume:
      'La mémoire s’use de façon prévisible ; revenir juste avant l’oubli, ' +
      'ni trop tôt ni trop tard, consolide plus durablement qu’une révision ' +
      'quotidienne.',
    application:
      'C’est le rôle du SRS (variante de l’algorithme SM-2) : chaque ' +
      'auto-évaluation (note 0–5, aisance technique) décale l’échéance de la ' +
      'prochaine révision, morceau par morceau.',
    sources:
      'Ebbinghaus (1885), la courbe de l’oubli · Cepeda et al. (2006), ' +
      'méta-analyse sur la pratique distribuée · Wozniak, algorithme SM-2 (SuperMemo)',
  },
];

function principeCard(principe: Principe): HTMLElement {
  return el(
    'section',
    { class: `${ui.card} flex flex-col gap-2` },
    el('h2', { class: 'text-lg font-semibold text-zinc-100' }, principe.titre),
    el('p', { class: 'text-sm text-zinc-300' }, principe.resume),
    el('p', { class: 'text-sm text-zinc-400' }, principe.application),
    el('p', { class: 'text-[11px] text-zinc-500' }, principe.sources),
  );
}

export function renderAbout(root: HTMLElement): () => void {

  root.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8' },

      el(
        'header',
        { class: 'flex flex-wrap items-start justify-between gap-4' },
        el(
          'div',
          {},
          el('h1', { class: 'text-3xl font-semibold text-zinc-100' }, 'Comment ça marche'),
          el(
            'p',
            { class: 'mt-1 text-sm text-zinc-400' },
            'Cinq principes de sciences cognitives, et ce qu’ils deviennent dans l’app.',
          ),
        ),
      ),

      ...PRINCIPES.map(principeCard),
    ),
  );

  return () => {};
}
