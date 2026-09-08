/** Préparation du filage : on choisit la partition affichée et la bande audio.
 *
 * Un seul bouton « Filage » sur le tableau de bord mène ici. Le choix d'audio
 * reste ensuite modifiable pendant tout le filage (voir `filage.ts`).
 */

import { el, ui } from '../dom';
import type { AudioKind, InstrumentId } from '../types';
import { INSTRUMENT_KEY_LABELS } from '../types';

export interface FilageConfigContext {
  setlistName: string;
  songCount: number;
  navigateHome: () => void;
  onStart: (instrumentId: InstrumentId, audioKind: AudioKind) => void;
}

const segClass = (on: boolean): string =>
  'min-h-11 flex-1 rounded-lg border px-3 text-sm font-medium transition ' +
  (on
    ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
    : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-700');

/** Groupe de boutons à choix unique. Rappelle `onPick` et se repeint seul. */
function segmented<T extends string>(
  options: { value: T; label: string }[],
  initial: T,
  onPick: (value: T) => void,
): HTMLElement {
  let current = initial;
  const buttons = options.map((option) => {
    const button = el(
      'button',
      { type: 'button', class: segClass(option.value === current) },
      option.label,
    );
    button.addEventListener('click', () => {
      current = option.value;
      buttons.forEach((other, i) => {
        other.className = segClass(options[i]!.value === current);
      });
      onPick(current);
    });
    return button;
  });
  return el('div', { class: 'flex gap-2' }, ...buttons);
}

export function renderFilageConfig(
  root: HTMLElement,
  context: FilageConfigContext,
): () => void {
  let instrumentId: InstrumentId = 'c';
  let audioKind: AudioKind = 'reference';

  const partitionGroup = segmented<InstrumentId>(
    (['c', 'bb', 'eb'] as InstrumentId[]).map((id) => ({
      value: id,
      label: INSTRUMENT_KEY_LABELS[id],
    })),
    instrumentId,
    (value) => {
      instrumentId = value;
    },
  );

  const audioGroup = segmented<AudioKind>(
    [
      { value: 'reference', label: 'Original' },
      { value: 'playback', label: 'Playback' },
    ],
    audioKind,
    (value) => {
      audioKind = value;
    },
  );

  const startButton = el('button', { type: 'button', class: ui.primary }, 'Commencer le filage');
  startButton.addEventListener('click', () => context.onStart(instrumentId, audioKind));

  const backButton = el(
    'button',
    { type: 'button', class: 'self-start text-sm text-zinc-400 hover:text-zinc-200' },
    'Retour',
  );
  backButton.addEventListener('click', () => context.navigateHome());

  const field = (label: string, control: HTMLElement, hint?: string): HTMLElement =>
    el(
      'div',
      { class: 'flex flex-col gap-2' },
      el('p', { class: ui.label }, label),
      control,
      hint ? el('p', { class: 'text-xs text-zinc-500' }, hint) : null,
    );

  root.replaceChildren(
    el(
      'div',
      { class: 'flex min-h-dvh flex-col items-center justify-center px-4 py-10' },
      el(
        'div',
        { class: 'flex w-full max-w-md flex-col gap-6' },
        backButton,
        el(
          'div',
          { class: 'flex flex-col gap-2' },
          el(
            'p',
            { class: 'text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90' },
            'Filage',
          ),
          el(
            'h1',
            { class: 'text-3xl font-semibold leading-tight text-zinc-50' },
            'Préparer le filage',
          ),
          el(
            'p',
            { class: 'text-sm text-zinc-400' },
            `${context.setlistName} · ${context.songCount} morceau${
              context.songCount > 1 ? 'x' : ''
            } enchaînés.`,
          ),
        ),
        field('Partition affichée', partitionGroup),
        field('Bande', audioGroup, 'Modifiable à tout moment pendant le filage.'),
        el('div', { class: 'flex' }, startButton),
      ),
    ),
  );

  return () => {};
}
