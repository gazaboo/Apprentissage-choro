/**
 * Navigation par sections : Répertoire, Technique, Compte, Aide.
 *
 * Barre fixe en bas sous `md` (pouce), rail vertical à gauche au-dessus. Elle
 * n'habille que les pages de premier niveau : les écrans d'activité (morceau,
 * séance, filage, exercice) gardent tout l'écran — et, sur mobile, le bas de
 * l'écran reste au dock audio.
 *
 * Les entrées sont de vrais liens (`href="#/…"`) : le routeur réagit déjà au
 * `hashchange`, et le clic milieu / « ouvrir dans un onglet » fonctionne.
 */

import { el } from '../dom';
import { activity, help, music, user } from '../icons';
import type { Progress } from '../store';

export type Section = 'repertoire' | 'technique' | 'compte' | 'aide';

export interface SectionShellOptions {
  active: Section;
  /** `false` quand le catalogue d'arpèges est absent : l'entrée disparaît. */
  hasTechnique: boolean;
  /** Pastille sur « Technique » : rien n'a encore été travaillé aujourd'hui. */
  techniqueDue: boolean;
}

interface Entry {
  section: Section;
  label: string;
  href: string;
  icon: () => SVGSVGElement;
}

const ENTRIES: Entry[] = [
  { section: 'repertoire', label: 'Répertoire', href: '#/', icon: music },
  { section: 'technique', label: 'Technique', href: '#/technique', icon: activity },
  { section: 'compte', label: 'Compte', href: '#/compte', icon: user },
  { section: 'aide', label: 'Aide', href: '#/aide', icon: help },
];

/**
 * Vrai si aucune séance technique n'a été enregistrée le jour calendaire
 * (heure locale) de `now` — c'est ce qui allume la pastille de l'entrée
 * « Technique », seul rappel visible depuis le répertoire.
 */
export function techniqueDueToday(progress: Pick<Progress, 'sessions'>, now: Date = new Date()): boolean {
  return !progress.sessions.some((run) => {
    if (run.kind !== 'technique') return false;
    const date = new Date(run.date);
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  });
}

/** Pastille bleu ciel (couleur de la technique), annoncée aux lecteurs d'écran. */
function dueDot(): HTMLElement {
  return el(
    'span',
    { class: 'absolute right-0 top-0 h-2 w-2 rounded-full bg-sky-400' },
    el('span', { class: 'sr-only' }, ' — pas encore travaillée aujourd’hui'),
  );
}

function link(entry: Entry, options: SectionShellOptions, layout: 'bar' | 'rail'): HTMLElement {
  const active = entry.section === options.active;
  const tone = active
    ? 'text-amber-300'
    : entry.section === 'technique'
      ? 'text-sky-300/80 hover:text-sky-200'
      : 'text-zinc-400 hover:text-zinc-200';
  const icon = el('span', { class: 'relative' }, entry.icon());
  if (entry.section === 'technique' && options.techniqueDue && !active) icon.append(dueDot());

  const shape =
    layout === 'bar'
      ? 'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium'
      : 'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ' +
        (active ? 'bg-amber-400/10' : 'hover:bg-zinc-800/60');
  return el(
    'a',
    {
      href: entry.href,
      class: `${shape} ${tone} transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400`,
      'aria-current': active ? 'page' : undefined,
    },
    icon,
    el('span', {}, entry.label),
  );
}

/**
 * Monte la coquille de navigation dans `root` et rend le conteneur où la vue
 * de la section se dessine (elle y fait son propre `replaceChildren`).
 */
export function mountSectionShell(root: HTMLElement, options: SectionShellOptions): HTMLElement {
  const entries = ENTRIES.filter((entry) => entry.section !== 'technique' || options.hasTechnique);

  const rail = el(
    'nav',
    {
      class:
        'sticky top-0 hidden h-screen w-52 shrink-0 flex-col gap-1 border-r ' +
        'border-zinc-800 bg-zinc-950 px-3 py-6 md:flex',
      'aria-label': 'Sections',
    },
    el('span', { class: 'px-3 pb-4 text-lg font-semibold text-zinc-100' }, 'Choros'),
    ...entries.map((entry) => link(entry, options, 'rail')),
  );

  const bar = el(
    'nav',
    {
      class:
        'fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-800 bg-zinc-950/95 ' +
        'pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden',
      'aria-label': 'Sections',
    },
    ...entries.map((entry) => link(entry, options, 'bar')),
  );

  // Sous `md`, la barre fixe recouvrirait la fin de la page : on réserve sa
  // hauteur (56 px + zone de sécurité) en bas du contenu.
  const content = el('main', {
    class: 'min-w-0 flex-1 max-md:pb-[calc(4.5rem+env(safe-area-inset-bottom))]',
  });

  root.replaceChildren(el('div', { class: 'flex min-h-screen' }, rail, content), bar);
  return content;
}
