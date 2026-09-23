/** Accueil et réglages par défaut.
 *
 * À la première arrivée, tant qu'aucun choix n'a été fait, cet écran occupe
 * toute la place (mode passerelle) : rester sur l'appareil, ou saisir un
 * identifiant pour retrouver sa progression partout. Ensuite il redevient une
 * page ordinaire (`#/compte`) qui ne propose plus que les réglages par
 * défaut — un utilisateur ne change pas de compte sur le même appareil.
 *
 * La synchro est automatique : au chargement, au retour au premier plan, et en
 * différé après chaque enregistrement. Aucun bouton « synchroniser ».
 */

import { el, ui } from '../dom';
import {
  chooseAnonymous,
  isValidCode,
  probeCode,
  setSyncCode,
  syncNow,
} from '../sync';
import { saveProgress, type Progress } from '../store';
import { renderDefaultSettingsFields } from './default-settings';
import { clearInstallPrompt, getInstallPrompt, isStandalone } from '../pwaInstall';
import type { Song } from '../types';

export interface AccountContext {
  /** `true` à la première arrivée : pas de retour possible, il faut choisir. */
  gate: boolean;
  /** Rappelé après tout changement : l'appelant recharge l'état et redessine. */
  onChange: () => void;
  /** Retour au répertoire (absent en mode passerelle). */
  navigateHome: (() => void) | null;
  /** Absents en mode passerelle : nécessaires pour la section réglages. */
  progress: Progress | null;
  songs: Song[];
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm ' +
  'text-zinc-100 placeholder:text-zinc-500 focus:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-amber-400';

/**
 * Champ « identifiant » : à la validation, interroge le serveur. Identifiant
 * connu → on se connecte et l'état est rechargé. Inconnu → on demande s'il faut
 * le créer.
 */
function codeForm(connect: (code: string) => void): HTMLElement {
  const input = el('input', {
    type: 'text',
    placeholder: 'Votre identifiant',
    'aria-label': 'Identifiant',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    class: inputClass,
  }) as HTMLInputElement;

  const error = el('p', { class: 'hidden text-sm text-rose-300' });
  const confirm = el('div', {
    class:
      'hidden flex-col gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-3',
  });
  const button = el('button', { type: 'button', class: ui.primary }, 'Se connecter');

  const say = (message: string): void => {
    error.textContent = message;
    error.classList.toggle('hidden', message === '');
  };
  const hideConfirm = (): void => {
    confirm.classList.add('hidden');
    confirm.classList.remove('flex');
  };

  async function submit(): Promise<void> {
    const value = input.value.trim();
    say('');
    hideConfirm();
    if (value.length < 3) {
      say('L’identifiant doit faire au moins 3 caractères.');
      return;
    }
    if (!isValidCode(value)) {
      say('Lettres, chiffres, tiret ou souligné uniquement.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Vérification…';
    const state = await probeCode(value);
    button.disabled = false;
    button.textContent = 'Se connecter';

    if (state === 'offline') {
      say('Pas de connexion — réessayez.');
      return;
    }
    if (state === 'known') {
      connect(value);
      return;
    }

    // Inconnu : proposer de créer l'espace.
    const createButton = el('button', { type: 'button', class: ui.primary }, 'Créer');
    createButton.addEventListener('click', () => connect(value));
    const cancelButton = el('button', { type: 'button', class: ui.button }, 'Annuler');
    cancelButton.addEventListener('click', () => {
      hideConfirm();
      input.focus();
    });
    confirm.replaceChildren(
      el(
        'p',
        { class: 'text-sm text-zinc-200' },
        `L’identifiant « ${value} » n’existe pas encore. Créer un nouvel espace ?`,
      ),
      el('div', { class: 'flex flex-wrap gap-2' }, createButton, cancelButton),
    );
    confirm.classList.remove('hidden');
    confirm.classList.add('flex');
  }

  button.addEventListener('click', () => void submit());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submit();
  });

  return el(
    'div',
    { class: 'flex flex-col gap-2' },
    input,
    el('div', { class: 'flex' }, button),
    error,
    confirm,
  );
}

/**
 * Carte d'installation PWA : n'apparaît que si le navigateur a effectivement
 * proposé l'installation (`beforeinstallprompt` capturé dès le démarrage par
 * `pwaInstall.ts`) et que l'app ne tourne pas déjà en fenêtre autonome.
 */
function installCard(): HTMLElement | null {
  if (isStandalone()) return null;
  const prompt = getInstallPrompt();
  if (!prompt) return null;

  const section = el(
    'section',
    { class: 'flex flex-col gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4' },
    el('p', { class: ui.label }, 'Installer'),
    el(
      'p',
      { class: 'text-sm text-zinc-400' },
      'Ajoutez l’app à votre écran d’accueil pour la lancer en plein écran, comme une application installée.',
    ),
  );
  const button = el('button', { type: 'button', class: ui.button }, 'Installer');
  button.addEventListener('click', () => {
    void (async () => {
      button.disabled = true;
      await prompt.prompt();
      await prompt.userChoice;
      // Acceptée ou refusée, l'invite ne peut resservir : on retire la
      // carte plutôt que de garder un bouton mort.
      clearInstallPrompt();
      section.remove();
    })();
  });
  section.append(el('div', { class: 'flex' }, button));
  return section;
}

function renderGate(context: AccountContext, connect: (code: string) => void): HTMLElement {
  const continueButton = el('button', { type: 'button', class: ui.button }, 'Continuer');
  continueButton.addEventListener('click', () => {
    chooseAnonymous();
    context.onChange();
  });

  return el(
    'div',
    { class: 'flex min-h-dvh flex-col items-center justify-center px-4 py-10' },
    el(
      'div',
      { class: 'flex w-full max-w-md flex-col gap-5' },
      el(
        'div',
        { class: 'flex flex-col gap-3' },
        el(
          'p',
          { class: 'text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90' },
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
        el('h2', { class: 'text-base font-medium text-zinc-100' }, 'Anonyme'),
        el(
          'p',
          { class: 'text-sm text-zinc-400' },
          'Données sur cet appareil uniquement — peut disparaître.',
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
        el('h2', { class: 'text-base font-medium text-zinc-100' }, 'Identifiant'),
        el(
          'p',
          { class: 'text-sm text-zinc-400' },
          'Données sauvegardées en ligne.',
        ),
        codeForm(connect),
      ),
    ),
  );
}

export function renderAccount(root: HTMLElement, context: AccountContext): () => void {
  /** Se connecter à un identifiant : l'état distant est fusionné puis rechargé. */
  function connect(code: string): void {
    setSyncCode(code);
    void syncNow().finally(() => context.onChange());
  }

  if (context.gate) {
    root.replaceChildren(renderGate(context, connect));
    return () => {};
  }

  const blocks: HTMLElement[] = [
    el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, 'Compte'),
  ];

  const install = installCard();
  if (install) blocks.push(install);

  if (context.progress) {
    const progress = context.progress;
    const fields = renderDefaultSettingsFields(
      context.songs,
      {
        instrumentDefault: progress.settings.instrumentDefault,
        display: progress.settings.display,
        contrechant: progress.settings.contrechant,
      },
      (next) => {
        progress.settings.instrumentDefault = next.instrumentDefault;
        progress.settings.display = next.display;
        progress.settings.contrechant = next.contrechant;
        saveProgress(progress);
      },
    );
    blocks.push(
      el(
        'section',
        { class: `${ui.card} flex flex-col gap-4` },
        el('p', { class: ui.label }, 'Réglages par défaut'),
        fields,
      ),
    );
  }

  const backButton = el(
    'button',
    { type: 'button', class: `${ui.icon} self-start`, 'aria-label': 'Retour au répertoire' },
    '←',
  );
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
