/** Accueil et gestion de la synchronisation.
 *
 * À la première arrivée, tant qu'aucun choix n'a été fait, cet écran occupe
 * toute la place (mode passerelle) : rester sur l'appareil, ou saisir un
 * identifiant pour retrouver sa progression partout. Ensuite il redevient une
 * page ordinaire (`#/compte`) où l'on active/coupe la synchro et où l'on
 * exporte/importe sa progression.
 */

import { el, ui } from '../dom';
import {
  accountMode,
  chooseAnonymous,
  formatLastSync,
  isValidCode,
  setSyncCode,
  signOut,
  syncNow,
} from '../sync';

export interface AccountContext {
  /** `true` à la première arrivée : pas de retour possible, il faut choisir. */
  gate: boolean;
  /** Rappelé après tout changement : l'appelant recharge l'état et redessine. */
  onChange: () => void;
  /** Retour au répertoire (absent en mode passerelle). */
  navigateHome: (() => void) | null;
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm ' +
  'text-zinc-100 placeholder:text-zinc-500 focus:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-amber-400';

/** Champ « identifiant » + bouton, avec message d'erreur intégré. */
function codeForm(submitLabel: string, onValid: (code: string) => void): HTMLElement {
  const input = el('input', {
    type: 'text',
    placeholder: 'Identifiant (6 caractères minimum)',
    'aria-label': 'Identifiant',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    class: inputClass,
  }) as HTMLInputElement;

  const error = el('p', { class: 'text-sm text-rose-300' });

  const button = el('button', { type: 'button', class: ui.primary }, submitLabel);
  const submit = (): void => {
    const value = input.value.trim();
    if (!isValidCode(value)) {
      error.textContent =
        'L’identifiant doit faire 6 à 64 caractères : lettres, chiffres, tiret ou souligné.';
      return;
    }
    onValid(value);
  };
  button.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  return el(
    'div',
    { class: 'flex flex-col gap-2' },
    input,
    el('div', { class: 'flex' }, button),
    error,
  );
}

function renderGate(context: AccountContext, activateSync: (code: string) => void): HTMLElement {
  const continueButton = el('button', { type: 'button', class: ui.button }, 'Continuer');
  continueButton.addEventListener('click', () => {
    chooseAnonymous();
    context.onChange();
  });

  return el(
    'div',
    {
      class: 'flex min-h-dvh flex-col items-center justify-center px-4 py-10',
    },
    el(
      'div',
      { class: 'flex w-full max-w-md flex-col gap-5' },
      el(
        'div',
        { class: 'flex flex-col gap-3' },
        el(
          'p',
          {
            class: 'text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90',
          },
          'Travail instrumental',
        ),
        el(
          'h1',
          { class: 'text-4xl font-semibold leading-tight text-zinc-50 sm:text-5xl' },
          'Répertoire de choros',
        ),
        el(
          'p',
          { class: 'text-sm leading-relaxed text-zinc-400' },
          'Partition à trous, filage de concert et répétition espacée pour ' +
            'mémoriser et tenir son répertoire.',
        ),
        el(
          'p',
          { class: 'pt-3 text-sm text-zinc-300' },
          'Avant de commencer — où garder votre progression ?',
        ),
      ),

      el(
        'section',
        { class: `${ui.card} flex flex-col gap-3` },
        el('h2', { class: 'text-base font-medium text-zinc-100' }, 'Sur cet appareil'),
        el(
          'p',
          { class: 'text-sm text-zinc-400' },
          'Enregistrée dans ce navigateur. Rien à retenir, mais elle ne suivra ' +
            'pas vers un autre appareil.',
        ),
        el('div', { class: 'flex' }, continueButton),
      ),

      el(
        'section',
        {
          class:
            'flex flex-col gap-3 rounded-xl border border-amber-400/30 ' +
            'bg-amber-400/[0.05] p-4',
        },
        el('h2', { class: 'text-base font-medium text-zinc-100' }, 'Sur tous mes appareils'),
        el(
          'p',
          { class: 'text-sm text-zinc-400' },
          'Choisissez un identifiant secret et saisissez le même sur votre ' +
            'téléphone, votre tablette… Votre progression vous suit partout.',
        ),
        codeForm('Commencer', activateSync),
      ),
    ),
  );
}

export function renderAccount(root: HTMLElement, context: AccountContext): () => void {
  const mode = accountMode();

  function activateSync(code: string): void {
    setSyncCode(code);
    void syncNow().finally(() => context.onChange());
  }

  if (context.gate) {
    root.replaceChildren(renderGate(context, activateSync));
    return () => {};
  }

  const blocks: HTMLElement[] = [
    el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, 'Compte'),
  ];

  if (mode === 'sync') {
    const syncButton = el('button', { type: 'button', class: ui.button }, 'Synchroniser maintenant');
    syncButton.addEventListener('click', () => {
      syncButton.disabled = true;
      syncButton.textContent = 'Synchronisation…';
      void syncNow().finally(() => context.onChange());
    });

    const outButton = el('button', { type: 'button', class: ui.button }, 'Se déconnecter');
    outButton.addEventListener('click', () => {
      signOut();
      context.onChange();
    });

    blocks.push(
      el(
        'section',
        { class: `${ui.card} flex flex-col gap-2` },
        el('p', { class: 'text-sm text-zinc-300' }, `Synchronisation active · ${formatLastSync()}`),
        el(
          'p',
          { class: 'text-sm text-zinc-500' },
          'Saisissez le même identifiant sur vos autres appareils. Les ' +
            'progressions sont fusionnées, rien n’est perdu.',
        ),
        el('div', { class: 'flex flex-wrap gap-2' }, syncButton, outButton),
      ),
    );
  } else {
    blocks.push(
      el(
        'section',
        { class: `${ui.card} flex flex-col gap-2` },
        el(
          'p',
          { class: 'text-sm text-zinc-300' },
          'Vous travaillez sur cet appareil uniquement.',
        ),
        el('p', { class: ui.label }, 'Synchroniser mes appareils'),
        codeForm('Activer', activateSync),
      ),
    );
  }

  const backButton = el('button', { type: 'button', class: ui.button }, 'Retour au répertoire');
  if (context.navigateHome) backButton.addEventListener('click', context.navigateHome);

  root.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-md flex-col gap-4 px-4 py-12' },
      ...(context.navigateHome ? [backButton] : []),
      ...blocks,
    ),
  );
  return () => {};
}
