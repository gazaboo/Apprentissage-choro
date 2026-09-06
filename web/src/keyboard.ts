/** Raccourcis clavier globaux, pensés pour jouer les mains sur l'instrument.
 *
 * Un seul écouteur pour toute l'application : la vue active enregistre ses
 * actions, et les remplace en changeant d'écran. Les touches sont neutralisées
 * dès qu'un champ de saisie a le focus.
 */

export type ShortcutHandlers = Partial<{
  playPause: () => void;
  toggleSource: () => void;
  hint: () => void;
  randomJump: () => void;
  ghostMode: () => void;
  nextInstrument: () => void;
  grade: (value: number) => void;
  help: () => void;
  escape: () => void;
}>;

let handlers: ShortcutHandlers = {};

export function setShortcuts(next: ShortcutHandlers): void {
  handlers = next;
}

export function clearShortcuts(): void {
  handlers = {};
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function installKeyboard(): void {
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;

    // `code` plutôt que `key` : les raccourcis restent au même endroit quelle
    // que soit la disposition du clavier (AZERTY comme QWERTY).
    const action = ((): (() => void) | undefined => {
      switch (event.code) {
        case 'Space':
          return handlers.playPause;
        case 'KeyP':
          return handlers.toggleSource;
        case 'KeyH':
          return handlers.hint;
        case 'KeyJ':
          return handlers.randomJump;
        case 'KeyG':
          return handlers.ghostMode;
        case 'KeyT':
          return handlers.nextInstrument;
        case 'Escape':
          return handlers.escape;
        default:
          break;
      }

      if (event.code === 'Slash' || event.key === '?') return handlers.help;

      const digit = /^(Digit|Numpad)([1-5])$/.exec(event.code);
      if (digit && handlers.grade) {
        const value = Number(digit[2]);
        return () => handlers.grade!(value);
      }
      return undefined;
    })();

    if (!action) return;
    event.preventDefault();
    action();
  });
}

export const SHORTCUT_HELP: Array<[string, string]> = [
  ['Espace', 'Lecture / Pause'],
  ['P', 'Basculer Référence / Playback'],
  ['H', 'Indice éphémère (2 s)'],
  ['J', 'Saut à froid avec décompte'],
  ['G', 'Ghost mode (écran noir)'],
  ['T', 'Instrument / transposition suivant'],
  ['1 – 5', 'Valider la note dans le questionnaire'],
  ['?', 'Afficher cette aide'],
];
