/** Habillage de la barre de transport, et panneau escamotable sur petit écran.
 *
 * Un seul jeu de nœuds DOM sert les deux tailles d'écran : on les déplace
 * d'un conteneur à l'autre au franchissement du point de rupture, plutôt que
 * d'en rendre deux copies. Les écouteurs et l'état visuel suivent donc le
 * déménagement sans qu'on ait à les recâbler.
 *
 * - ≥ 1024 px : dock flottant arrondi en bas, centré. Les réglages secondaires
 *   se déplient dans le dock, sur un bouton « Réglages » : repliés, ils
 *   laissent toute la hauteur à la partition, qui défile derrière.
 * - < 1024 px : barre basse de ~72 px (lecture, défilement, vitesse) dans la
 *   zone du pouce ; les mêmes réglages passent derrière un bouton flottant qui
 *   ouvre un panneau par le bas.
 */

import { el, ui } from './dom';
import type { Section } from './transport';

const DESKTOP = '(min-width: 1024px)';

export interface ControlBarOptions {
  /** Contrôles toujours visibles : lecture, défilement, vitesse. */
  primary: HTMLElement;
  /** Réglages secondaires, inline sur grand écran, en panneau sur petit. */
  sections: Section[];
}

export interface ControlBar {
  /** À insérer dans le document ; se positionne lui-même en `fixed`. */
  root: HTMLElement;
  destroy: () => void;
}

function sectionBlock(section: Section): HTMLElement {
  return el(
    'section',
    { class: 'flex min-w-0 max-w-md flex-col gap-2' },
    el('h3', { class: ui.label }, section.title),
    section.hint
      ? el('p', { class: '-mt-1 text-xs leading-snug text-zinc-500' }, section.hint)
      : null,
    section.body,
  );
}

export function createControlBar(options: ControlBarOptions): ControlBar {
  const blocks = options.sections.map(sectionBlock);

  // --- Dock / barre basse --------------------------------------------------

  const inlineHost = el('div', {
    class: 'flex flex-wrap items-start gap-x-8 gap-y-4 border-t border-white/8 pt-4',
  });
  // L'enveloppe porte le repli : poser `hidden` sur `inlineHost` lui-même
  // entrerait en conflit avec son `flex`, et le laisserait en bloc déplié.
  const inlineSlot = el('div', { class: 'hidden' }, inlineHost);

  // Sur grand écran, les réglages se déplient par-dessus la partition plutôt
  // que de l'écraser en permanence : la barre reste haute d'une seule rangée.
  const toggle = el(
    'button',
    { type: 'button', class: ui.button, 'aria-expanded': 'false' },
    '\u2699\uFE0E Réglages',
  );
  // Le masquage porte sur l'enveloppe : `ui.button` impose `inline-flex`, qui
  // l'emporterait sur un `hidden` posé sur le bouton lui-même.
  const toggleSlot = el('div', { class: 'hidden shrink-0 lg:block' }, toggle);

  function setExpanded(expanded: boolean): void {
    inlineSlot.classList.toggle('hidden', !expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.className = expanded ? ui.buttonActive : ui.button;
  }
  toggle.addEventListener('click', () => {
    setExpanded(inlineSlot.classList.contains('hidden'));
  });

  const dock = el(
    'div',
    {
      class:
        'transport-shell pointer-events-auto mx-auto flex w-full max-w-5xl ' +
        'flex-col gap-3 p-2 lg:p-3',
    },
    el('div', { class: 'flex w-full items-center gap-3' }, options.primary, toggleSlot),
    inlineSlot,
  );

  const root = el(
    'div',
    {
      class:
        'pointer-events-none fixed inset-x-0 bottom-0 z-30 px-2 lg:px-4 ' +
        '[padding-bottom:calc(env(safe-area-inset-bottom)+0.5rem)] ' +
        'lg:[padding-bottom:calc(env(safe-area-inset-bottom)+1.5rem)]',
    },
    dock,
  );

  // --- Panneau des réglages (petit écran) ----------------------------------

  const sheetBody = el('div', { class: 'flex flex-col gap-5' });

  const closeButton = el(
    'button',
    { type: 'button', class: ui.icon, 'aria-label': 'Fermer les réglages' },
    '\u2715',
  );

  const header = el(
    'div',
    {
      // Collant : avec cinq sections, le panneau défile, et la fermeture ne
      // doit jamais passer sous la ligne de flottaison.
      class:
        'sticky top-0 z-10 -mx-5 -mt-5 mb-4 flex items-center justify-between ' +
        'gap-3 bg-zinc-900/95 px-5 pt-4 pb-3 backdrop-blur',
    },
    el('h2', { class: 'text-sm font-semibold text-zinc-200' }, 'Réglages'),
    closeButton,
  );

  const panel = el(
    'div',
    {
      class:
        'transport-shell pointer-events-auto max-h-[80vh] w-full overflow-y-auto ' +
        'rounded-b-none p-5 pt-0 ' +
        '[padding-bottom:calc(env(safe-area-inset-bottom)+2rem)]',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Réglages',
    },
    header,
    sheetBody,
  );

  const sheet = el(
    'div',
    {
      class:
        'fixed inset-0 z-40 hidden items-end justify-center bg-zinc-950/70 backdrop-blur-sm',
    },
    panel,
  );
  document.body.appendChild(sheet);

  function openSheet(): void {
    sheet.classList.remove('hidden');
    sheet.classList.add('flex');
  }
  function closeSheet(): void {
    sheet.classList.add('hidden');
    sheet.classList.remove('flex');
  }
  closeButton.addEventListener('click', closeSheet);
  // Un tap hors du panneau referme : c'est le geste attendu, et il évite de
  // devoir viser le bouton quand on a l'instrument en main.
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) closeSheet();
  });

  const fab = el(
    'button',
    {
      type: 'button',
      class:
        'transport-shell pointer-events-auto fixed right-4 z-30 flex h-14 w-14 ' +
        'items-center justify-center text-xl text-zinc-200 shadow-lg ' +
        'shadow-black/40 focus:outline-none focus-visible:ring-2 ' +
        'focus-visible:ring-amber-400 ' +
        '[bottom:calc(env(safe-area-inset-bottom)+6.5rem)]',
      'aria-label': 'Ouvrir les réglages',
    },
    '\u2699\uFE0E',
  );
  fab.addEventListener('click', openSheet);
  document.body.appendChild(fab);

  // --- Répartition selon la largeur ---------------------------------------

  const query = window.matchMedia(DESKTOP);

  function layout(): void {
    const empty = blocks.length === 0;
    if (query.matches) {
      closeSheet();
      inlineHost.append(...blocks);
      fab.classList.add('hidden');
      toggleSlot.classList.toggle('lg:hidden', empty);
    } else {
      sheetBody.append(...blocks);
      // Le panneau déplié du bureau ne doit pas rester ouvert en dessous du
      // point de rupture, où il n'a plus de place.
      setExpanded(false);
      fab.classList.toggle('hidden', empty);
    }
  }

  layout();
  query.addEventListener('change', layout);

  return {
    root,
    destroy: () => {
      query.removeEventListener('change', layout);
      sheet.remove();
      fab.remove();
    },
  };
}
