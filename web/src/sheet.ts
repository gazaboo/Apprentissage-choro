/** Habillage de la barre de transport, et panneau escamotable sur petit écran.
 *
 * Un seul jeu de nœuds DOM sert les deux tailles d'écran : on les déplace
 * d'un conteneur à l'autre au franchissement du point de rupture, plutôt que
 * d'en rendre deux copies. Les écouteurs et l'état visuel suivent donc le
 * déménagement sans qu'on ait à les recâbler.
 *
 * - ≥ 768 px : dock flottant arrondi en bas, centré, **tout sur une ligne**
 *   (lecture, frise, bascules, Réglages). Les réglages s'ouvrent dans un
 *   popover étroit et **déplaçable** : la partition reste visible à côté, si
 *   bien qu'on voit l'effet de chaque réglage au moment où on le touche, et
 *   l'on pousse le panneau là où il ne gêne pas. Ce seuil est volontairement
 *   bas — la ligne unique tient dès ~768 px, et la garder pour « ≥ 1024 »
 *   seulement faisait retomber sur la pile verticale (bien plus haute) dès
 *   qu'on avait une mise à l'échelle d'affichage ou un zoom < 100 %.
 * - < 768 px : barre basse de ~72 px (lecture, défilement, vitesse) dans la
 *   zone du pouce ; les mêmes réglages s'ouvrent par le bas, à la hauteur de
 *   leur contenu. Pas de déplacement : sur un téléphone, il n'y a nulle part
 *   où le mettre.
 */

import { el, ui } from './dom';
import type { Section } from './transport';

const DESKTOP = '(min-width: 768px)';

export interface ControlBarOptions {
  /** Contrôles toujours visibles : lecture, défilement, vitesse. */
  primary: HTMLElement;
  /** Réglages secondaires : popover déplaçable, ou panneau par le bas. */
  sections: Section[];
  /** Dernière position du popover, ou `null` pour l'ancrage par défaut. */
  panelPosition: { x: number; y: number } | null;
  /** Appelé quand l'utilisateur a fini de déplacer le popover. */
  onPanelMoved: (position: { x: number; y: number }) => void;
}

export interface ControlBar {
  /** À insérer dans le document ; se positionne lui-même en `fixed`. */
  root: HTMLElement;
  destroy: () => void;
}

function sectionBlock(section: Section): HTMLElement {
  return el(
    'section',
    { class: 'flex min-w-0 flex-col gap-3 py-5 first:pt-0 last:pb-0' },
    el('h3', { class: 'text-sm font-semibold text-zinc-100' }, section.title),
    section.hint
      ? el('p', { class: '-mt-2 text-xs leading-snug text-zinc-500' }, section.hint)
      : null,
    section.body,
  );
}

export function createControlBar(options: ControlBarOptions): ControlBar {
  const blocks = options.sections.map(sectionBlock);

  // --- Dock / barre basse --------------------------------------------------

  const body = el('div', { class: 'flex flex-col divide-y divide-zinc-800' });

  const closeButton = el(
    'button',
    { type: 'button', class: ui.icon, 'aria-label': 'Fermer les réglages' },
    '\u2715',
  );

  const grip = el(
    'span',
    { class: 'flex flex-col gap-[3px]', 'aria-hidden': 'true' },
    el('span', { class: 'h-px w-4 bg-zinc-600' }),
    el('span', { class: 'h-px w-4 bg-zinc-600' }),
  );

  const header = el(
    'div',
    {
      // Collant : le panneau défile quand les réglages débordent, et la
      // fermeture ne doit jamais passer sous la ligne de flottaison.
      class:
        'panel-header sticky top-0 z-10 -mx-4 -mt-4 mb-3 flex items-center gap-3 ' +
        'rounded-t-2xl bg-zinc-900/95 px-4 py-3 backdrop-blur',
    },
    grip,
    el('h2', { class: 'flex-1 text-sm font-semibold text-zinc-200' }, 'Réglages'),
    closeButton,
  );

  const panel = el(
    'div',
    {
      class:
        'transport-shell pointer-events-auto flex w-full flex-col overflow-y-auto p-4 pt-0',
      role: 'dialog',
      'aria-modal': 'false',
      'aria-label': 'Réglages',
    },
    header,
    body,
  );

  // Enveloppe : plein écran avec fond assombri sur petit écran, simple couche
  // de positionnement sur grand écran — où la partition doit rester visible.
  const overlay = el('div', { class: 'fixed inset-0 z-40' }, panel);
  // L'affichage est piloté par `style.display` et non par la classe `hidden` :
  // celle-ci entrerait en concurrence avec le `flex` dont le panneau du bas a
  // besoin pour se coller en bas, et l'ordre des règles déciderait à notre
  // place.
  let isOpen = false;
  document.body.appendChild(overlay);

  // Un seul bouton d'ouverture, deux tailles : libellé complet sur grand
  // écran, icône seule dans le coin de la barre sur petit écran. Les deux
  // vivent dans la barre — plus de bouton flottant qui se cogne au reste.
  const toggle = el(
    'button',
    { type: 'button', class: `${ui.button} shrink-0`, 'aria-expanded': 'false' },
    '\u2699\uFE0E Réglages',
  );
  // Le masquage porte sur l'enveloppe : `ui.button` impose `inline-flex`, qui
  // l'emporterait sur un `hidden` posé sur le bouton lui-même.
  const toggleSlot = el('div', { class: 'hidden shrink-0 md:block' }, toggle);

  const miniToggle = el(
    'button',
    {
      type: 'button',
      class: `${ui.icon} shrink-0 md:hidden`,
      'aria-label': 'Ouvrir les réglages',
      'aria-expanded': 'false',
    },
    '⚙︎',
  );

  const dock = el(
    'div',
    {
      class:
        'transport-shell pointer-events-auto mx-auto flex w-full max-w-5xl ' +
        'flex-col gap-3 p-2 md:p-3',
    },
    el(
      'div',
      // Sur petit écran, l'engrenage s'aligne en bas, au niveau de la rangée
      // de bascules ; sur grand écran, tout est sur une ligne.
      { class: 'flex w-full items-end gap-2 md:items-center md:gap-3' },
      el('div', { class: 'min-w-0 flex-1' }, options.primary),
      miniToggle,
      toggleSlot,
    ),
  );

  const root = el(
    'div',
    {
      class:
        'pointer-events-none fixed inset-x-0 bottom-0 z-30 px-2 md:px-4 ' +
        '[padding-bottom:calc(env(safe-area-inset-bottom)+0.5rem)] ' +
        'md:[padding-bottom:calc(env(safe-area-inset-bottom)+1.5rem)]',
    },
    dock,
  );


  const query = window.matchMedia(DESKTOP);

  // --- Position du popover -------------------------------------------------

  const PANEL_W = 360;
  let position = options.panelPosition;

  /**
   * Ramène le popover dans la fenêtre. Sans cela, un panneau laissé au bord
   * d'un grand écran deviendrait inatteignable sur un écran plus petit, ou
   * après un simple redimensionnement.
   */
  function clamp(x: number, y: number): { x: number; y: number } {
    const height = panel.offsetHeight || 320;
    return {
      x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - PANEL_W - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - height - 8)),
    };
  }

  /** Ancrage par défaut : au-dessus du bouton Réglages, à droite. */
  function defaultPosition(): { x: number; y: number } {
    const dockBox = dock.getBoundingClientRect();
    const height = panel.offsetHeight || 320;
    return clamp(dockBox.right - PANEL_W, dockBox.top - height - 12);
  }

  function placePanel(): void {
    if (!query.matches) {
      panel.style.left = panel.style.top = panel.style.width = '';
      return;
    }
    const target = clamp(
      position?.x ?? defaultPosition().x,
      position?.y ?? defaultPosition().y,
    );
    position = target;
    panel.style.width = `${PANEL_W}px`;
    panel.style.left = `${target.x}px`;
    panel.style.top = `${target.y}px`;
  }

  let drag: { dx: number; dy: number } | null = null;
  header.addEventListener('pointerdown', (event) => {
    if (!query.matches) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const box = panel.getBoundingClientRect();
    drag = { dx: event.clientX - box.left, dy: event.clientY - box.top };
    header.setPointerCapture(event.pointerId);
    header.classList.add('is-dragging');
  });
  header.addEventListener('pointermove', (event) => {
    if (!drag) return;
    position = clamp(event.clientX - drag.dx, event.clientY - drag.dy);
    panel.style.left = `${position.x}px`;
    panel.style.top = `${position.y}px`;
  });
  const endDrag = (): void => {
    if (!drag) return;
    drag = null;
    header.classList.remove('is-dragging');
    if (position) options.onPanelMoved(position);
  };
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);

  // --- Ouverture et fermeture ----------------------------------------------

  function setOpen(open: boolean): void {
    isOpen = open;
    overlay.style.display = open ? (query.matches ? 'block' : 'flex') : 'none';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.className = `${open ? ui.buttonActive : ui.button} shrink-0`;
    miniToggle.setAttribute('aria-expanded', String(open));
    miniToggle.className =
      `${open ? ui.iconActive : ui.icon} shrink-0 md:hidden` +
      (blocks.length === 0 ? ' hidden' : '');
    if (open) placePanel();
  }

  toggle.addEventListener('click', () => setOpen(!isOpen));
  miniToggle.addEventListener('click', () => setOpen(!isOpen));
  closeButton.addEventListener('click', () => setOpen(false));
  // Un tap hors du panneau referme, mais seulement sur petit écran : sur
  // grand écran l'enveloppe ne couvre rien, et cliquer la partition pour
  // fermer serait un piège.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay && !query.matches) setOpen(false);
  });

  // --- Répartition selon la largeur ---------------------------------------

  function layout(): void {
    const empty = blocks.length === 0;
    body.append(...blocks);
    toggleSlot.classList.toggle('md:hidden', empty);
    if (query.matches) {
      overlay.className = 'fixed inset-0 z-40 pointer-events-none';
      panel.classList.add('rounded-2xl', 'fixed', 'max-h-[70vh]');
      panel.classList.remove('rounded-b-none', 'max-h-[75vh]');
      header.classList.add('cursor-grab');
    } else {
      overlay.className =
        'fixed inset-0 z-40 items-end justify-center bg-zinc-950/70 backdrop-blur-sm';
      panel.classList.remove('rounded-2xl', 'fixed', 'cursor-grab');
      panel.classList.add('rounded-b-none', 'max-h-[75vh]');
      header.classList.remove('cursor-grab');
      panel.style.left = panel.style.top = panel.style.width = '';
    }
    // `className` vient d'être réécrit : on repose l'affichage, et on referme,
    // un panneau ouvert n'ayant pas la même forme de part et d'autre du point
    // de rupture.
    setOpen(false);
  }

  layout();
  const onResize = (): void => {
    if (query.matches && position) {
      position = clamp(position.x, position.y);
      placePanel();
    }
  };
  query.addEventListener('change', layout);
  window.addEventListener('resize', onResize);

  return {
    root,
    destroy: () => {
      query.removeEventListener('change', layout);
      window.removeEventListener('resize', onResize);
      overlay.remove();
    },
  };
}
