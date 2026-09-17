/** Préparation du filage : on choisit la partition affichée et la bande audio.
 *
 * Un seul bouton « Filage » sur le tableau de bord mène ici. Le choix d'audio
 * reste ensuite modifiable pendant tout le filage (voir `filage.ts`).
 */

import { el, segmented, ui } from '../dom';
import type { Progress } from '../store';
import type { AudioKind, InstrumentId } from '../types';
import { INSTRUMENT_KEY_LABELS } from '../types';

export interface FilageConfigContext {
  progress: Progress;
  setlistName: string;
  songCount: number;
  navigateHome: () => void;
  onStart: (instrumentId: InstrumentId, audioKind: AudioKind) => void;
}

export function renderFilageConfig(
  root: HTMLElement,
  context: FilageConfigContext,
): () => void {
  let instrumentId: InstrumentId = context.progress.settings.instrumentDefault;
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
