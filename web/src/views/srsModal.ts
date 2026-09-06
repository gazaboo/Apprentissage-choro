/** Questionnaire d'auto-évaluation de fin de morceau.
 *
 * Conçu pour être rempli en moins de cinq secondes, instrument en main : deux
 * rangées de gros boutons et une note pré-suggérée d'après les indices
 * déclenchés. Tout se fait au doigt, il n'y a rien à taper.
 */

import { el, ui } from '../dom';
import { GRADE_LABELS, TEMPO_LABELS, suggestGrade } from '../srs';
import type { Tempo } from '../types';

export interface SrsAnswer {
  grade: number;
  tempo: Tempo;
  hints: number;
}

const TEMPOS: Tempo[] = ['sous-tempo', 'crispe', 'fluide'];

/**
 * Affiche la modale et résout avec la réponse, ou `null` si l'utilisateur
 * passe son tour (échapper) — mieux vaut aucune donnée qu'une note bâclée.
 */
export function askSrs(
  title: string,
  instrumentName: string,
  hints: number,
  maskedCount: number,
): Promise<SrsAnswer | null> {
  return new Promise((resolve) => {
    const suggested = suggestGrade(hints, maskedCount);
    let grade = suggested;
    let tempo: Tempo = 'crispe';

    const gradeButtons: HTMLButtonElement[] = [];
    const tempoButtons: HTMLButtonElement[] = [];
    const gradeCaption = el('p', { class: 'mt-2 text-sm text-zinc-400' });

    const paint = (): void => {
      gradeButtons.forEach((button, index) => {
        button.className = index === grade ? ui.buttonActive : ui.button;
      });
      tempoButtons.forEach((button, index) => {
        button.className = TEMPOS[index] === tempo ? ui.buttonActive : ui.button;
      });
      gradeCaption.textContent = GRADE_LABELS[grade] ?? '';
    };

    const setGrade = (value: number): void => {
      grade = Math.max(0, Math.min(5, value));
      paint();
    };

    for (let value = 0; value <= 5; value += 1) {
      const button = el(
        'button',
        { type: 'button', class: ui.button, 'aria-label': GRADE_LABELS[value] },
        String(value),
      );
      button.addEventListener('click', () => setGrade(value));
      gradeButtons.push(button);
    }

    for (const value of TEMPOS) {
      const button = el(
        'button',
        { type: 'button', class: ui.button },
        TEMPO_LABELS[value],
      );
      button.addEventListener('click', () => {
        tempo = value;
        paint();
      });
      tempoButtons.push(button);
    }

    const overlay = el('div', {
      class:
        'fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm',
    });

    const validate = el('button', { type: 'button', class: ui.primary }, 'Enregistrer');
    const skip = el('button', { type: 'button', class: ui.button }, 'Passer');

    const close = (answer: SrsAnswer | null): void => {
      overlay.remove();
      resolve(answer);
    };

    validate.addEventListener('click', () => close({ grade, tempo, hints }));
    skip.addEventListener('click', () => close(null));

    overlay.append(
      el(
        'div',
        {
          class:
            'w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl',
          role: 'dialog',
          'aria-modal': 'true',
        },
        el('p', { class: ui.label }, 'Auto-évaluation'),
        el('h2', { class: 'mt-1 text-xl font-semibold text-zinc-100' }, title),
        el('p', { class: 'text-sm text-zinc-500' }, instrumentName),

        el(
          'p',
          { class: 'mt-4 rounded-lg bg-zinc-800/60 px-3 py-2 text-sm text-zinc-400' },
          hints === 0
            ? 'Aucun indice déclenché pendant ce passage.'
            : `${hints} indice${hints > 1 ? 's' : ''} déclenché${hints > 1 ? 's' : ''} sur ${maskedCount} mesure${maskedCount > 1 ? 's' : ''} masquée${maskedCount > 1 ? 's' : ''}.`,
        ),

        el('p', { class: `${ui.label} mt-5` }, 'Mémoire (0 – 5)'),
        el('div', { class: 'mt-2 grid grid-cols-6 gap-2' }, ...gradeButtons),
        gradeCaption,

        el('p', { class: `${ui.label} mt-5` }, 'Aisance technique et tempo'),
        el('div', { class: 'mt-2 grid grid-cols-3 gap-2' }, ...tempoButtons),

        el('div', { class: 'mt-6 flex flex-wrap justify-end gap-2' }, skip, validate),
      ),
    );

    document.body.appendChild(overlay);
    paint();
    validate.focus();
  });
}
