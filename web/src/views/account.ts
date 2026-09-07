/** Accès au « compte » : écran d'accueil et gestion de la synchro.
 *
 * À l'arrivée sur le site, tant qu'aucun choix n'a été fait, cet écran occupe
 * toute la place (mode passerelle) et propose deux voies : rester anonyme, ou
 * saisir un code de synchro. Ensuite il redevient une page ordinaire,
 * accessible par `#/compte`, où l'on active/désactive la synchro et où l'on
 * exporte/importe sa progression.
 */

import { el, ui } from '../dom';
import { exportProgress, importProgress } from '../store';
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
  'text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400';

/** Champ « code de synchro » + bouton, avec message d'erreur intégré. */
function codeForm(submitLabel: string, onValid: (code: string) => void): HTMLElement {
  const input = el('input', {
    type: 'text',
    placeholder: 'Code de synchro (6 caractères ou plus)',
    'aria-label': 'Code de synchro',
    class: inputClass,
  }) as HTMLInputElement;

  const error = el('p', { class: 'text-sm text-rose-300' });

  const button = el('button', { type: 'button', class: ui.primary }, submitLabel);
  const submit = (): void => {
    const value = input.value.trim();
    if (!isValidCode(value)) {
      error.textContent =
        'Le code doit faire 6 à 64 caractères : lettres, chiffres, tiret ou souligné.';
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

/** Boutons Exporter / Importer un fichier JSON, filet de sécurité sans réseau. */
function backupRow(onChange: () => void): HTMLElement {
  const error = el('p', { class: 'text-sm text-rose-300' });

  const exportButton = el('button', { type: 'button', class: ui.button }, 'Exporter');
  exportButton.addEventListener('click', () => {
    const blob = new Blob([exportProgress()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = el('a', {
      href: url,
      download: `choro-progression-${new Date().toISOString().slice(0, 10)}.json`,
    });
    anchor.click();
    URL.revokeObjectURL(url);
  });

  const field = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'hidden',
  }) as HTMLInputElement;
  const importButton = el('button', { type: 'button', class: ui.button }, 'Importer');
  importButton.addEventListener('click', () => field.click());
  field.addEventListener('change', () => {
    const file = field.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      if (importProgress(text)) onChange();
      else error.textContent = 'Fichier illisible — la progression n’a pas été touchée.';
    });
  });

  return el(
    'section',
    { class: 'flex flex-col gap-2 border-t border-zinc-800 pt-4' },
    el('p', { class: ui.label }, 'Sauvegarde manuelle'),
    el(
      'p',
      { class: 'text-sm text-zinc-400' },
      'Un fichier à transférer soi-même, utile sans réseau ou comme copie de secours.',
    ),
    el('div', { class: 'flex flex-wrap gap-2' }, exportButton, importButton, field),
    error,
  );
}

export function renderAccount(root: HTMLElement, context: AccountContext): () => void {
  const mode = accountMode();

  function activateSync(code: string): void {
    setSyncCode(code);
    void syncNow().finally(() => context.onChange());
  }

  const blocks: HTMLElement[] = [];

  if (context.gate) {
    blocks.push(
      el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, 'Votre progression'),
      el(
        'p',
        { class: 'text-sm text-zinc-400' },
        'Comment souhaitez-vous conserver votre travail ?',
      ),
    );

    const anonButton = el(
      'button',
      { type: 'button', class: ui.primary },
      'Continuer sans compte',
    );
    anonButton.addEventListener('click', () => {
      chooseAnonymous();
      context.onChange();
    });

    blocks.push(
      el(
        'section',
        { class: `${ui.card} flex flex-col gap-2` },
        el('h2', { class: 'text-base font-medium text-zinc-100' }, 'Sans compte'),
        el(
          'p',
          { class: 'text-sm text-zinc-400' },
          'La progression est enregistrée sur cet appareil uniquement.',
        ),
        el('div', { class: 'flex' }, anonButton),
      ),
      el(
        'section',
        { class: `${ui.card} flex flex-col gap-2` },
        el('h2', { class: 'text-base font-medium text-zinc-100' }, 'Avec un code de synchro'),
        el(
          'p',
          { class: 'text-sm text-zinc-400' },
          'Retrouvez votre progression sur tous vos appareils. Saisissez le même ' +
            'code partout ; un code encore inutilisé crée un nouveau compte.',
        ),
        codeForm('Valider', activateSync),
      ),
    );
  } else {
    blocks.push(el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, 'Compte'));

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
            'Saisissez le même code sur vos autres appareils. Les progressions ' +
              'sont fusionnées, rien n’est perdu.',
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
            'Vous travaillez sans compte : la progression reste sur cet appareil.',
          ),
          el('p', { class: ui.label }, 'Activer la synchro'),
          codeForm('Activer', activateSync),
        ),
      );
    }

    blocks.push(backupRow(context.onChange));
  }

  const shell = el(
    'div',
    { class: 'mx-auto flex max-w-md flex-col gap-4 px-4 py-12' },
    ...(context.navigateHome
      ? [
          (() => {
            const back = el('button', { type: 'button', class: ui.button }, 'Retour au répertoire');
            back.addEventListener('click', context.navigateHome);
            return back;
          })(),
        ]
      : []),
    ...blocks,
  );

  root.replaceChildren(shell);
  return () => {};
}
