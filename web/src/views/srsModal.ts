/** Questionnaire d'auto-évaluation de fin de morceau.
 *
 * Conçu pour être rempli en moins de cinq secondes, instrument en main : deux
 * rangées de gros boutons et une note pré-suggérée d'après les indices
 * déclenchés. Tout se fait au doigt, il n'y a rien à taper.
 */

import { el, paintToggle, ui } from '../dom';
import { GRADE_LABELS, TEMPO_LABELS, suggestGrade } from '../srs';
import type { Tempo } from '../types';

export interface SrsAnswer {
  grade: number;
  tempo: Tempo;
  hints: number;
}

const TEMPOS: Tempo[] = ['sous-tempo', 'crispe', 'fluide'];

/**
 * Affiche la modale et résout avec la réponse, `null` si l'utilisateur passe
 * son tour (« Passer » — mieux vaut aucune donnée qu'une note bâclée, mais
 * l'appelant enchaîne quand même), ou `'cancelled'` si l'utilisateur annule
 * l'évaluation entière (croix, Échap, clic hors de la modale) — l'appelant
 * doit alors ni noter, ni enchaîner, et laisser l'utilisateur reprendre
 * l'exercice.
 *
 * `contexte` remplace le rappel des indices déclenchés par un autre relevé —
 * pour les arpèges et gammes, le tempo tenu et ce que le micro a entendu. Il
 * informe la note ; il ne la décide pas.
 *
 * `detail` ajoute sous ce relevé le note-à-note de ce que le micro a entendu,
 * quand l'appelant en fournit un : un résumé chiffré seul ne permet pas de
 * distinguer une faute de jeu d'une erreur du détecteur, et c'est justement ce
 * doute qui décourage de se fier au relevé.
 *
 * `maxSuggested` plafonne la note *présélectionnée* (jamais les boutons eux-
 * mêmes, toujours cliquables) — pour ne pas suggérer un 5 quand l'utilisateur
 * a rouvert la partition en cours de route.
 */
export function askSrs(
  title: string,
  instrumentName: string,
  hints: number,
  maskedCount: number,
  contexte?: string,
  detail?: Node,
  maxSuggested?: number,
): Promise<SrsAnswer | null | 'cancelled'> {
  return new Promise((resolve) => {
    const suggested = suggestGrade(hints, maskedCount);
    let grade = Math.min(suggested, maxSuggested ?? 5);
    let tempo: Tempo = 'crispe';

    const gradeButtons: HTMLButtonElement[] = [];
    const tempoButtons: HTMLButtonElement[] = [];
    const gradeCaption = el('p', { class: 'mt-2 text-sm text-zinc-400' });

    const paint = (): void => {
      gradeButtons.forEach((button, index) => {
        paintToggle(button, index === grade);
      });
      tempoButtons.forEach((button, index) => {
        paintToggle(button, TEMPOS[index] === tempo);
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
    const cancelButton = el(
      'button',
      { type: 'button', class: ui.icon, 'aria-label': "Annuler l'évaluation, revenir à l'exercice" },
      '✕',
    );

    const close = (result: SrsAnswer | null | 'cancelled'): void => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(result);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close('cancelled');
    };

    validate.addEventListener('click', () => close({ grade, tempo, hints }));
    skip.addEventListener('click', () => close(null));
    cancelButton.addEventListener('click', () => close('cancelled'));
    // Seul un clic sur le voile lui-même ferme — pas un clic qui a démarré
    // dans la modale et fini dessus (sélection de texte relâchée dehors).
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) close('cancelled');
    });
    document.addEventListener('keydown', onKeyDown);

    overlay.append(
      el(
        'div',
        {
          class:
            'w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl',
          role: 'dialog',
          'aria-modal': 'true',
        },
        el(
          'div',
          { class: 'flex items-start justify-between gap-3' },
          el(
            'div',
            {},
            el('p', { class: ui.label }, 'Auto-évaluation'),
            el('h2', { class: 'mt-1 text-xl font-semibold text-zinc-100' }, title),
            el('p', { class: 'text-sm text-zinc-500' }, instrumentName),
          ),
          cancelButton,
        ),

        el(
          'p',
          { class: 'mt-4 rounded-lg bg-zinc-800/60 px-3 py-2 text-sm text-zinc-400' },
          contexte ??
            (hints === 0
              ? 'Aucun indice déclenché pendant ce passage.'
              : `${hints} indice${hints > 1 ? 's' : ''} déclenché${hints > 1 ? 's' : ''} sur ${maskedCount} mesure${maskedCount > 1 ? 's' : ''} masquée${maskedCount > 1 ? 's' : ''}.`),
        ),

        ...(detail
          ? [
              el(
                'div',
                {
                  class:
                    'mt-2 max-h-40 overflow-y-auto rounded-lg bg-zinc-800/40 px-3 py-2 ' +
                    'font-mono text-xs leading-relaxed text-zinc-400',
                },
                detail,
              ),
            ]
          : []),

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
