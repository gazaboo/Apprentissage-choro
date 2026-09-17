/** Assistant d'accueil : deux questions posées une seule fois, à la toute
 *  première visite, juste après le choix anonyme/identifiant. Les mêmes
 *  réglages restent modifiables à tout moment depuis la page Compte
 *  (`account.ts`).
 */

import { el, ui } from '../dom';
import { renderDefaultSettingsFields, type DefaultSettingsValues } from './default-settings';
import type { Song } from '../types';

export interface OnboardingContext {
  songs: Song[];
  onComplete: (values: DefaultSettingsValues) => void;
}

export function renderOnboarding(root: HTMLElement, context: OnboardingContext): () => void {
  let values: DefaultSettingsValues = {
    instrumentDefault: 'c',
    display: 'partition',
    contrechant: 'sans',
  };

  const fields = renderDefaultSettingsFields(context.songs, values, (next) => {
    values = next;
  });

  const cta = el('button', { type: 'button', class: ui.primary }, 'Continuer');
  cta.addEventListener('click', () => context.onComplete(values));

  root.replaceChildren(
    el(
      'div',
      { class: 'flex min-h-dvh flex-col items-center justify-center px-4 py-10' },
      el(
        'div',
        { class: 'flex w-full max-w-md flex-col gap-6' },
        el(
          'div',
          { class: 'flex flex-col gap-2' },
          el(
            'h1',
            { class: 'text-3xl font-semibold leading-tight text-zinc-50' },
            'Réglages par défaut',
          ),
          el('p', { class: 'text-sm text-zinc-400' }, 'Modifiable à tout moment plus tard.'),
        ),
        fields,
        el('div', { class: 'flex' }, cta),
      ),
    ),
  );

  return () => {};
}
