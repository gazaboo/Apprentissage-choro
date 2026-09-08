/** Point d'entrée : chargement du manifeste, routage, orchestration.
 *
 * Routes (par fragment d'URL) :
 *   #/            tableau de bord
 *   #/song/:id    entraînement libre sur un morceau
 *   #/session     séance de travail (fond ou urgences), calée sur la setlist active
 *   #/filage      préparation du filage (choix partition + bande)
 *   #/filage/run  filage de la setlist, audio enchaîné
 *   #/compte      accès au compte et à la synchro
 *
 * Tant qu'aucun choix de compte n'a été fait, l'écran d'accueil (`#/compte` en
 * mode passerelle) s'impose avant toute autre vue.
 */

import './style.css';

import { el, ui } from './dom';
import { buildRotation, pickSessionItems } from './session';
import type { SessionBlock, SessionItem } from './session';
import { activeSetlist, lastSession, loadProgress, recordSession } from './store';
import type { Progress } from './store';
import { accountMode, initSync, syncNow } from './sync';
import type { AudioKind, InstrumentId, Song } from './types';
import { Player } from './youtube';
import { renderAccount } from './views/account';
import { renderDashboard } from './views/dashboard';
import { renderFilage } from './views/filage';
import { renderFilageConfig } from './views/filage-config';
// L'édition des setlists est une modale ouverte depuis le tableau de bord,
// plus une route dédiée.
import { renderTrainer } from './views/trainer';

const MANIFEST_URL = 'data/manifest.json';

const root = document.getElementById('app');
if (!root) throw new Error('Élément #app introuvable.');

const player = new Player();
let progress: Progress = loadProgress();
let songs: Song[] = [];
/** Démontage de l'écran courant, à appeler avant d'en afficher un autre. */
let teardown: (() => void) | null = null;

/** Contexte commun aux séances : d'où viennent les morceaux. */
interface SessionScope {
  setlistId: string | null;
  setlistName: string;
}

/** Session de travail en cours (entrelacée « urgent » ou fond « deep »). */
type SessionState = SessionScope &
  (
    | { kind: 'urgent'; blocks: SessionBlock[]; index: number; worked: Set<string> }
    | {
        kind: 'deep';
        pool: Song[];
        order: SessionItem[];
        index: number;
        worked: Set<string>;
      }
  );

/** Filage en cours. */
type FilageState = SessionScope & {
  order: Song[];
  instrumentId: InstrumentId;
  audioKind: AudioKind;
  reached: Set<string>;
};

let session: SessionState | null = null;
let filage: FilageState | null = null;

function navigate(hash: string): void {
  if (window.location.hash === hash) render();
  else window.location.hash = hash;
}

/** Item (morceau + instrument) du bloc courant d'une session. */
function currentSessionItem(state: SessionState): SessionItem {
  return state.kind === 'urgent'
    ? state.blocks[state.index]!.item
    : state.order[state.index]!;
}

/** Enregistre la séance en cours si au moins un morceau a été travaillé. */
function recordCurrentRun(): void {
  if (session && session.worked.size > 0) {
    recordSession(progress, {
      date: new Date().toISOString(),
      kind: session.kind,
      instrumentId: null,
      setlistId: session.setlistId,
      setlistName: session.setlistName,
      songCount: session.worked.size,
    });
  }
  if (filage && filage.reached.size > 0) {
    recordSession(progress, {
      date: new Date().toISOString(),
      kind: 'filage',
      instrumentId: filage.instrumentId,
      setlistId: filage.setlistId,
      setlistName: filage.setlistName,
      songCount: filage.reached.size,
    });
  }
}

function goHome(): void {
  recordCurrentRun();
  session = null;
  filage = null;
  navigate('#/');
}

function scopeFromActiveSetlist(): SessionScope {
  const set = activeSetlist(progress);
  return { setlistId: set?.id ?? null, setlistName: set ? set.name : 'Tout le répertoire' };
}

function poolForActiveSetlist(): Song[] {
  const set = activeSetlist(progress);
  return set ? songs.filter((song) => set.songIds.includes(song.id)) : songs;
}

function startSession(kind: 'deep' | 'urgent'): void {
  const scope = scopeFromActiveSetlist();
  const pool = poolForActiveSetlist();
  if (kind === 'urgent') {
    const items = pickSessionItems(pool, progress, 3);
    if (items.length === 0) return;
    session = { ...scope, kind, blocks: buildRotation(items), index: 0, worked: new Set() };
  } else {
    const order = pickSessionItems(pool, progress, pool.length);
    if (order.length === 0) return;
    session = { ...scope, kind, pool, order, index: 0, worked: new Set() };
  }
  filage = null;
  navigate('#/session');
}

/** Morceaux du filage : l'ordre de la setlist (ordre de concert), pas l'ordre SRS. */
function filageOrder(): Song[] {
  const set = activeSetlist(progress);
  return set
    ? set.songIds
        .map((id) => songs.find((song) => song.id === id))
        .filter((song): song is Song => song !== undefined)
    : [...songs];
}

/** Ouvre l'écran de préparation du filage (choix partition + bande). */
function startFilage(): void {
  if (filageOrder().length === 0) return;
  navigate('#/filage');
}

/** Passe au bloc suivant, ou termine la session. */
function advanceSession(): void {
  if (!session) {
    goHome();
    return;
  }
  session.worked.add(currentSessionItem(session).song.id);
  session.index += 1;
  if (session.kind === 'urgent') {
    if (session.index >= session.blocks.length) {
      finishRun();
      return;
    }
  } else if (session.index >= session.order.length) {
    // Travail de fond : on boucle en recalculant l'ordre (des morceaux sont
    // devenus moins urgents après ce tour), jusqu'à arrêt de l'utilisateur.
    session.order = pickSessionItems(session.pool, progress, session.pool.length);
    session.index = 0;
  }
  render();
}

/** Termine la séance en cours (session ou filage), l'enregistre, montre le résumé. */
function finishRun(): void {
  recordCurrentRun();
  session = null;
  filage = null;
  showSessionSummary();
}

const RUN_KIND_LABELS: Record<string, string> = {
  deep: 'Travail de fond',
  urgent: 'Révision des urgences',
  filage: 'Filage',
};

function showSessionSummary(): void {
  teardown?.();
  teardown = null;
  const run = lastSession(progress);
  root!.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16' },
      el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, 'Séance terminée'),
      el(
        'p',
        { class: 'text-zinc-400' },
        run
          ? `${RUN_KIND_LABELS[run.kind] ?? 'Séance'} · ${run.setlistName} · ` +
              `${run.songCount} morceau${run.songCount > 1 ? 'x' : ''}. ` +
              'Les évaluations éventuelles sont enregistrées, la synchro est à jour.'
          : 'Aucun morceau travaillé — rien n’a été enregistré.',
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

  // Passerelle d'accueil : tant qu'aucun choix n'est fait, elle passe avant tout.
  const account = accountMode();
  if (account === 'none' || hash === '#/compte') {
    teardown = renderAccount(root!, {
      gate: account === 'none',
      onChange: () => {
        progress = loadProgress();
        // Un identifiant vient d'être saisi/créé depuis la page compte : on
        // ramène l'utilisateur au répertoire plutôt que de rester sur « Compte ».
        if (hash === '#/compte' && accountMode() !== 'none') navigate('#/');
        else render();
      },
      navigateHome: account === 'none' ? null : goHome,
    });
    return;
  }

  if (hash === '#/session' && session) {
    const { song, instrumentId } = currentSessionItem(session);
    // On force l'instrument choisi par la session en le plaçant en tête.
    const ordered: Song = {
      ...song,
      instruments: [
        ...song.instruments.filter((i) => i.id === instrumentId),
        ...song.instruments.filter((i) => i.id !== instrumentId),
      ],
    };
    const position = session.index + 1;
    const label =
      session.kind === 'urgent'
        ? `Révision des urgences · ${session.setlistName} — bloc ${position} sur ${session.blocks.length}`
        : `Travail de fond · ${session.setlistName} — morceau ${position} sur ${session.order.length}`;
    teardown = renderTrainer(root!, ordered, {
      progress,
      player,
      navigateHome: goHome,
      session: {
        kind: session.kind,
        label,
        blockMinutes: session.kind === 'urgent' ? progress.settings.blockMinutes : null,
        onBlockEnd: advanceSession,
        onStopSession: finishRun,
      },
    });
    return;
  }

  if (hash === '#/filage') {
    const order = filageOrder();
    if (order.length === 0) {
      goHome();
      return;
    }
    const scope = scopeFromActiveSetlist();
    teardown = renderFilageConfig(root!, {
      setlistName: scope.setlistName,
      songCount: order.length,
      navigateHome: goHome,
      onStart: (instrumentId, audioKind) => {
        session = null;
        filage = { ...scope, order: filageOrder(), instrumentId, audioKind, reached: new Set() };
        navigate('#/filage/run');
      },
    });
    return;
  }

  if (hash === '#/filage/run' && filage) {
    teardown = renderFilage(root!, {
      player,
      order: filage.order,
      instrumentId: filage.instrumentId,
      audioKind: filage.audioKind,
      setlistName: filage.setlistName,
      markReached: (id) => filage?.reached.add(id),
      navigateHome: goHome,
      onFinish: finishRun,
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
    openAccount: () => navigate('#/compte'),
    startSession,
    startFilage,
  });
}

async function boot(): Promise<void> {
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

  // Synchro entre appareils (silencieuse si aucun code n'est renseigné).
  initSync(() => {
    progress = loadProgress();
    render();
  });
  try {
    await syncNow();
  } catch {
    /* hors ligne ou fonction absente : on démarre sur l'état local */
  }
  progress = loadProgress();

  window.addEventListener('hashchange', render);
  render();
}

void boot();
