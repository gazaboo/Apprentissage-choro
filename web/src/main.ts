/** Point d'entrée : chargement du manifeste, routage, orchestration.
 *
 * Routes (par fragment d'URL) :
 *   #/            tableau de bord
 *   #/song/:id    entraînement libre sur un morceau
 *   #/session     session du jour entrelacée
 */

import './style.css';

import { el, ui } from './dom';
import { installKeyboard, setShortcuts } from './keyboard';
import { buildRotation, pickSessionItems } from './session';
import type { SessionBlock } from './session';
import { loadProgress } from './store';
import type { Progress } from './store';
import type { Song } from './types';
import { Player } from './youtube';
import { renderDashboard } from './views/dashboard';
import { renderTrainer } from './views/trainer';

const MANIFEST_URL = 'data/manifest.json';

const root = document.getElementById('app');
if (!root) throw new Error('Élément #app introuvable.');

const player = new Player();
let progress: Progress = loadProgress();
let songs: Song[] = [];
/** Démontage de l'écran courant, à appeler avant d'en afficher un autre. */
let teardown: (() => void) | null = null;

/** Session entrelacée en cours, le cas échéant. */
let session: { blocks: SessionBlock[]; index: number } | null = null;

function navigate(hash: string): void {
  if (window.location.hash === hash) render();
  else window.location.hash = hash;
}

function goHome(): void {
  session = null;
  navigate('#/');
}

function startSession(count: number): void {
  const items = pickSessionItems(songs, progress, count);
  if (items.length === 0) return;
  session = { blocks: buildRotation(items), index: 0 };
  navigate('#/session');
}

/** Passe au bloc suivant de la rotation, ou termine la session. */
function advanceSession(): void {
  if (!session) {
    goHome();
    return;
  }
  session.index += 1;
  if (session.index >= session.blocks.length) {
    session = null;
    showSessionSummary();
    return;
  }
  render();
}

function showSessionSummary(): void {
  teardown?.();
  teardown = null;
  setShortcuts({});
  root!.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16' },
      el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, 'Session terminée'),
      el(
        'p',
        { class: 'text-zinc-400' },
        'Les évaluations sont enregistrées ; les intervalles de révision ont été ' +
          'recalculés en conséquence.',
      ),
      backHome(),
    ),
  );
}

function backHome(): HTMLElement {
  const button = el('button', { type: 'button', class: ui.primary }, 'Retour au répertoire');
  button.addEventListener('click', goHome);
  return button;
}

function showError(message: string): void {
  root!.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-2xl flex-col gap-3 px-4 py-16' },
      el('h1', { class: 'text-xl font-semibold text-zinc-100' }, 'Impossible de charger le répertoire'),
      el('p', { class: 'text-sm text-zinc-400' }, message),
      el(
        'p',
        { class: 'text-sm text-zinc-500' },
        'Lancez d’abord le prétraitement : ',
        el('code', { class: 'font-mono text-zinc-400' }, 'python scripts/preprocess_all.py'),
      ),
    ),
  );
}

function render(): void {
  teardown?.();
  teardown = null;

  const hash = window.location.hash || '#/';

  if (hash === '#/session' && session) {
    const block = session.blocks[session.index]!;
    const { song, instrumentId } = block.item;
    // On force l'instrument choisi par la session en le plaçant en tête.
    const ordered: Song = {
      ...song,
      instruments: [
        ...song.instruments.filter((i) => i.id === instrumentId),
        ...song.instruments.filter((i) => i.id !== instrumentId),
      ],
    };
    teardown = renderTrainer(root!, ordered, {
      progress,
      player,
      navigateHome: goHome,
      session: {
        blocks: session.blocks,
        blockIndex: session.index + 1,
        blockMinutes: progress.settings.blockMinutes,
        onBlockEnd: advanceSession,
      },
    });
    return;
  }

  const songMatch = /^#\/song\/(.+)$/.exec(hash);
  if (songMatch) {
    const song = songs.find((candidate) => candidate.id === songMatch[1]);
    if (song) {
      teardown = renderTrainer(root!, song, {
        progress,
        player,
        navigateHome: goHome,
      });
      return;
    }
  }

  teardown = renderDashboard(root!, songs, {
    progress,
    openSong: (songId) => navigate(`#/song/${songId}`),
    startSession,
  });
}

async function boot(): Promise<void> {
  installKeyboard();
  try {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    songs = (await response.json()) as Song[];
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    return;
  }
  if (songs.length === 0) {
    showError('Le manifeste ne contient aucun morceau.');
    return;
  }

  progress = loadProgress();
  window.addEventListener('hashchange', render);
  render();
}

void boot();
