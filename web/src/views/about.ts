/** Page « Comment ça marche » — d'abord l'usage courant, puis (repliés) les
 *  principes de mémorisation qui le sous-tendent.
 *
 * Vue statique, à destination de l'utilisateur (pas des développeurs).
 * L'essentiel (séance, répétition espacée, catalogue, évaluation, synchro)
 * est expliqué en langage courant, sans jargon ni référence à
 * l'architecture interne — c'est ce qu'un nouvel utilisateur doit
 * comprendre pour s'en servir. Les sources de sciences cognitives, plus
 * denses, restent disponibles sous « Pour aller plus loin » pour qui veut
 * creuser.
 */

import { el, ui } from '../dom';

interface Essentiel {
  titre: string;
  texte: string;
}

const ESSENTIELS: Essentiel[] = [
  {
    titre: 'La séance du jour',
    texte:
      'Chaque jour, l’app propose quelques morceaux à retravailler — ceux qui ' +
      'commencent à s’oublier. On peut aussi parcourir tout le répertoire, ou ' +
      'préparer un concert en enchaînant la setlist sans interruption (le filage).',
  },
  {
    titre: 'La répétition espacée',
    texte:
      'Après chaque morceau, on indique si ça revient facilement ou pas. Plus ' +
      'c’est su, plus l’app attend avant d’y revenir ; plus c’est fragile, plus ' +
      'tôt elle le reproposera — l’idée est de réviser juste avant d’oublier.',
  },
  {
    titre: 'Le catalogue et les setlists',
    texte:
      'Tout le répertoire est disponible, mais on peut le restreindre à une ' +
      'setlist — un concert à préparer, un sous-ensemble à bosser. La séance et ' +
      'le filage s’appuient alors sur cette sélection plutôt que sur le ' +
      'catalogue entier.',
  },
  {
    titre: 'Évaluation et feedback',
    texte:
      'À la fin d’un morceau, une courte auto-évaluation (de « rien ne revient » ' +
      'à « parfait, sans indice ») et un tempo. C’est elle qui décide de la ' +
      'prochaine révision.',
  },
  {
    titre: 'Sauvegarde et synchronisation',
    texte:
      'La progression est enregistrée automatiquement sur l’appareil. Avec un ' +
      'identifiant (page Compte), elle se synchronise aussi entre plusieurs ' +
      'appareils.',
  },
];

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

function essentielCard(essentiel: Essentiel): HTMLElement {
  return el(
    'section',
    { class: `${ui.card} flex flex-col gap-1` },
    el('h2', { class: 'text-base font-medium text-zinc-100' }, essentiel.titre),
    el('p', { class: 'text-sm text-zinc-300' }, essentiel.texte),
  );
}

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
            'L’essentiel pour s’en servir, en cinq points.',
          ),
        ),
      ),

      ...ESSENTIELS.map(essentielCard),

      el(
        'details',
        { class: `${ui.card}` },
        el(
          'summary',
          { class: 'cursor-pointer text-sm font-medium text-zinc-200' },
          'Pour aller plus loin — les principes de sciences cognitives',
        ),
        el('div', { class: 'mt-4 flex flex-col gap-4' }, ...PRINCIPES.map(principeCard)),
      ),
    ),
  );

  return () => {};
}
