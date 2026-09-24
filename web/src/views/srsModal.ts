/** Questionnaire d'auto-évaluation de fin de morceau.
 *
 * Conçu pour être rempli d'un seul geste, instrument en main : le tempo tenu
 * d'abord (présélectionné), puis un appui sur l'une des quatre notes, qui
 * enregistre. Un bref écran de confirmation laisse rattraper un appui raté
 * avant que la note ne parte. Tout se fait au doigt, il n'y a rien à taper.
 *
 * Aucune note n'est présélectionnée ni mise en avant : la suggestion tirée des
 * indices orientait la réponse, alors que la note doit dire ce qui s'est passé.
 */

import { el, paintToggle, ui } from '../dom';
import { GRADES, TEMPO_LABELS } from '../srs';
import type { Tempo } from '../types';

export interface SrsAnswer {
  grade: number;
  tempo: Tempo;
  hints: number;
}

const TEMPOS: Tempo[] = ['sous-tempo', 'crispe', 'fluide'];

/** Libellés courts de la bascule de tempo : trois par rangée sur 360 px. */
const TEMPO_SHORT: Record<Tempo, string> = {
  'sous-tempo': 'Sous-tempo',
  crispe: 'Réel, crispé',
  fluide: 'Réel, fluide',
};

/** Délai de l'écran de confirmation avant que la note ne parte d'elle-même. */
export const CONFIRM_DELAY_MS = 2500;

/**
 * Affiche la modale et résout avec la réponse, `null` si l'utilisateur passe
 * son tour (« Passer sans noter » — mieux vaut aucune donnée qu'une note
 * bâclée, mais l'appelant enchaîne quand même), ou `'cancelled'` si
 * l'utilisateur annule l'évaluation entière (croix, Échap, clic hors de la
 * modale) — l'appelant doit alors ni noter, ni enchaîner, et laisser
 * l'utilisateur reprendre l'exercice.
 *
 * `contexte` remplace le rappel des indices déclenchés par un autre relevé —
 * pour les arpèges et gammes, le tempo tenu et ce que le micro a entendu. Il
 * informe la note ; il ne la décide pas.
 *
 * `detail` ajoute sous ce relevé le note-à-note de ce que le micro a entendu,
 * quand l'appelant en fournit un : un résumé chiffré seul ne permet pas de
 * distinguer une faute de jeu d'une erreur du détecteur, et c'est justement ce
 * doute qui décourage de se fier au relevé.
 */
export function askSrs(
  title: string,
  instrumentName: string,
  hints: number,
  maskedCount: number,
  contexte?: string,
  detail?: Node,
): Promise<SrsAnswer | null | 'cancelled'> {
  return new Promise((resolve) => {
    let tempo: Tempo = 'crispe';
    let pending: SrsAnswer | null = null;
    let timer: number | null = null;

    const tempoButtons = TEMPOS.map((value) => {
      const button = el('button', { type: 'button' }, TEMPO_SHORT[value]);
      button.addEventListener('click', () => {
        tempo = value;
        paintTempo();
      });
      return button;
    });
    const paintTempo = (): void => {
      tempoButtons.forEach((button, index) => {
        paintToggle(button, TEMPOS[index] === tempo, 'button', 'px-2 leading-tight');
        button.setAttribute('aria-pressed', String(TEMPOS[index] === tempo));
      });
    };

    const gradeButtons = GRADES.map((grade) => {
      const button = el(
        'button',
        {
          type: 'button',
          'data-grade': grade.value,
          class:
            'flex min-h-18 w-full items-center gap-3 rounded-xl border border-zinc-700 ' +
            'bg-zinc-800 px-4 py-3 text-left transition hover:border-zinc-500 ' +
            'hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 ' +
            'focus-visible:ring-amber-400',
        },
        el(
          'span',
          { class: 'flex grow flex-col gap-0.5' },
          el('span', { class: 'text-base font-semibold text-zinc-100' }, grade.name),
          el('span', { class: 'text-sm leading-snug text-zinc-400' }, grade.description),
        ),
        el('span', { class: 'shrink-0 text-xl text-zinc-500', 'aria-hidden': 'true' }, '›'),
      );
      button.addEventListener('click', () => choose(grade.value));
      return button;
    });

    const overlay = el('div', {
      class:
        'fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm',
    });

    const skip = el(
      'button',
      {
        type: 'button',
        class:
          'min-h-11 rounded-lg px-4 text-sm text-zinc-400 underline underline-offset-2 ' +
          'transition hover:text-zinc-200 focus:outline-none focus-visible:ring-2 ' +
          'focus-visible:ring-amber-400',
      },
      'Passer sans noter',
    );
    const cancelButton = el(
      'button',
      { type: 'button', class: ui.icon, 'aria-label': "Annuler l'évaluation, revenir à l'exercice" },
      '✕',
    );

    const choice = el(
      'div',
      {},
      el('p', { class: `${ui.label} mt-5` }, 'Tempo tenu'),
      el('div', { class: 'mt-2 grid grid-cols-3 gap-2' }, ...tempoButtons),
      el('p', { class: `${ui.label} mt-5` }, 'Mémoire — un appui enregistre'),
      el('div', { class: 'mt-2 flex flex-col gap-2' }, ...gradeButtons),
      el('div', { class: 'mt-4 flex justify-center' }, skip),
    );

    const confirmText = el('p', { class: 'text-base font-semibold text-zinc-100' });
    const undo = el(
      'button',
      { type: 'button', class: ui.button },
      'Annuler, je me suis trompé de note',
    );
    const proceed = el('button', { type: 'button', class: ui.primary }, 'Continuer');
    const confirmation = el(
      'div',
      {
        class:
          'mt-5 flex flex-col items-center gap-3 rounded-xl bg-zinc-800/60 px-4 py-6 text-center',
        role: 'status',
        hidden: true,
      },
      el(
        'span',
        {
          class:
            'flex h-10 w-10 items-center justify-center rounded-full border-2 ' +
            'border-amber-400 text-lg text-amber-400',
          'aria-hidden': 'true',
        },
        '✓',
      ),
      confirmText,
      el('p', { class: 'text-sm text-zinc-400' }, 'Suite dans quelques secondes…'),
      el('div', { class: 'flex flex-wrap justify-center gap-2' }, undo, proceed),
    );

    const stopTimer = (): void => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const close = (result: SrsAnswer | null | 'cancelled'): void => {
      stopTimer();
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(result);
    };

    function choose(grade: number): void {
      pending = { grade, tempo, hints };
      const name = GRADES.find((entry) => entry.value === grade)!.name;
      confirmText.textContent = `Enregistré : ${name} · ${TEMPO_LABELS[tempo].toLowerCase()}`;
      choice.hidden = true;
      confirmation.hidden = false;
      proceed.focus();
      timer = window.setTimeout(() => close(pending), CONFIRM_DELAY_MS);
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close('cancelled');
    };

    undo.addEventListener('click', () => {
      stopTimer();
      const previous = pending;
      pending = null;
      confirmation.hidden = true;
      choice.hidden = false;
      gradeButtons.find((button) => Number(button.dataset.grade) === previous?.grade)?.focus();
    });
    proceed.addEventListener('click', () => close(pending));
    skip.addEventListener('click', () => close(null));
    cancelButton.addEventListener('click', () => close('cancelled'));
    // Seul un clic sur le voile lui-même ferme — pas un clic qui a démarré
    // dans la modale et fini dessus (sélection de texte relâchée dehors).
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) close('cancelled');
    });
    document.addEventListener('keydown', onKeyDown);

    const dialog = el(
      'div',
      {
        class:
          'max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 ' +
          'bg-zinc-900 p-5 shadow-2xl focus:outline-none sm:p-6',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': `Auto-évaluation — ${title}`,
        tabindex: '-1',
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

      choice,
      confirmation,
    );
    overlay.append(dialog);

    document.body.appendChild(overlay);
    paintTempo();
    // Le focus va à la modale, pas à une note : un Entrée réflexe ne doit
    // rien enregistrer à la place du musicien.
    dialog.focus();
  });
}
