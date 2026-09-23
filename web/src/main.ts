/** Point d'entrée : chargement du manifeste, routage, orchestration.
 *
 * Routes (par fragment d'URL) :
 *   #/            tableau de bord
 *   #/song/:id    entraînement libre sur un morceau
 *   #/session     séance de travail (fond ou urgences), calée sur la setlist active
 *   #/filage      préparation du filage (choix partition + bande)
 *   #/filage/run  filage de la setlist, audio enchaîné
 *   #/technique      arpèges et gammes : vue d'ensemble
 *   #/technique/run  séance d'arpèges et gammes, au métronome
 *   #/compte      accès au compte et à la synchro
 *   #/aide        principes de mémorisation expliqués à l'utilisateur
 *
 * Tant qu'aucun choix de compte n'a été fait, l'écran d'accueil (`#/compte` en
 * mode passerelle) s'impose avant toute autre vue.
 */

import './style.css';

import { initAnalytics } from './analytics';
import { el, ui } from './dom';
import { buildRotation, pickSessionItems } from './session';
import type { SessionBlock, SessionItem } from './session';
import {
  activeSetlist,
  activeTechniqueSetlist,
  isDemoActive,
  lastSession,
  loadProgress,
  recordSession,
  saveProgress,
  stopDemo,
} from './store';
import type { Progress } from './store';
import {
  accountMode,
  hasCompletedOnboarding,
  initSync,
  markOnboardingComplete,
  syncNow,
} from './sync';
import type { ExerciceCarte } from './technique/catalogue';
import { chargerCatalogue, pickExercices } from './technique/catalogue';
import type { AudioKind, InstrumentId, Song } from './types';
import { Player } from './audio';
import { renderAbout } from './views/about';
import { renderAccount } from './views/account';
import { renderDashboard } from './views/dashboard';
import { renderDemo } from './views/demo';
import { renderFilage } from './views/filage';
import { renderFilageConfig } from './views/filage-config';
import { renderOnboarding } from './views/onboarding';
// L'édition des setlists est une modale ouverte depuis le tableau de bord,
// plus une route dédiée.
import { renderTechnique } from './views/technique';
import { renderTechniqueListe } from './views/technique-liste';
import { mountSectionShell, techniqueDueToday } from './views/nav';
import type { Section } from './views/nav';
import { renderTrainer } from './views/trainer';

const MANIFEST_URL = 'data/manifest.json';

const root = document.getElementById('app');
if (!root) throw new Error('Élément #app introuvable.');

// Bandeau de rappel permanent en mode démonstration (#109, outil de QA,
// route cachée `#/demo`) — hors de `root` pour survivre à ses
// `replaceChildren()` et rester visible sur tous les écrans tant que le
// mode est actif. Sticky plutôt que fixe : aucun conflit de z-index avec les
// voiles plein écran/éclipses de `trainer.ts`.
const demoQuitButton = el(
  'button',
  { type: 'button', class: 'underline underline-offset-2' },
  'Quitter',
);
const demoBanner = el(
  'div',
  {
    class:
      'sticky top-0 z-[60] hidden items-center justify-between gap-3 bg-amber-400 ' +
      'px-4 py-2 text-sm font-medium text-zinc-950',
  },
  el(
    'span',
    {},
    '🔧 Mode démonstration — données de test, sans effet sur ta progression réelle.',
  ),
  demoQuitButton,
);
demoQuitButton.addEventListener('click', () => {
  stopDemo();
  progress = loadProgress();
  navigate('#/');
});
document.body.prepend(demoBanner);
function paintDemoBanner(): void {
  const active = isDemoActive();
  demoBanner.classList.toggle('hidden', !active);
  demoBanner.classList.toggle('flex', active);
}

const player = new Player();
let progress: Progress = loadProgress();
let songs: Song[] = [];
/** Catalogue d'arpèges et de gammes ; vide si le fichier est absent. */
let exercices: ExerciceCarte[] = [];
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

/** Séance d'arpèges et gammes en cours. */
interface TechniqueState {
  ordre: ExerciceCarte[];
  worked: Set<string>;
}

let session: SessionState | null = null;
let filage: FilageState | null = null;
let technique: TechniqueState | null = null;

function navigate(hash: string): void {
  if (window.location.hash === hash) render();
  else window.location.hash = hash;
}

/**
 * Une activité est en cours sur ces routes (lecture, plein écran, exercice au
 * métronome) : un rafraîchissement en arrière-plan n'a pas à démonter la vue,
 * sous peine de couper l'audio ou de réinitialiser sa progression locale
 * (#79, #81). L'utilisateur récupère l'état à jour à la prochaine navigation.
 */
function isLiveActivityRoute(hash: string): boolean {
  return (
    hash === '#/session' ||
    hash === '#/technique/run' ||
    hash === '#/filage/run' ||
    /^#\/song\/(.+)$/.test(hash)
  );
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
  if (technique && technique.worked.size > 0) {
    // La technique a sa propre setlist, distincte de celle du répertoire
    // (#127) : on y renvoie ici comme pour les autres modes, plutôt que de
    // coder en dur un libellé de section.
    const techniqueSet = activeTechniqueSetlist(progress);
    recordSession(progress, {
      date: new Date().toISOString(),
      kind: 'technique',
      instrumentId: null,
      setlistId: techniqueSet?.id ?? null,
      setlistName: techniqueSet ? techniqueSet.name : 'Tout le catalogue',
      songCount: technique.worked.size,
    });
  }
}

function goHome(): void {
  recordCurrentRun();
  session = null;
  filage = null;
  technique = null;
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

/** Vivier technique courant : la setlist de technique active, ou tout le catalogue. */
function techniquePoolForActiveSetlist(): ExerciceCarte[] {
  const set = activeTechniqueSetlist(progress);
  return set ? exercices.filter((carte) => set.exerciceIds.includes(carte.id)) : exercices;
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

/** Lance la séance d'arpèges et gammes, dans l'ordre du sélecteur SRS. */
function startTechnique(): void {
  const ordre = pickExercices(techniquePoolForActiveSetlist(), progress);
  if (ordre.length === 0) return;
  session = null;
  filage = null;
  technique = { ordre, worked: new Set() };
  navigate('#/technique/run');
}

/** Lance une séance restreinte à la tonalité choisie dans le sélecteur dédié. */
function startTechniqueTonalite(ordre: ExerciceCarte[]): void {
  if (ordre.length === 0) return;
  session = null;
  filage = null;
  technique = { ordre, worked: new Set() };
  navigate('#/technique/run');
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
  technique = null;
  showSessionSummary();
}

const RUN_KIND_LABELS: Record<string, string> = {
  deep: 'Travail de fond',
  urgent: 'Révision des urgences',
  filage: 'Filage',
  technique: 'Arpèges et gammes',
};

/** « 3 morceaux » ou « 3 exercices », selon ce que la séance a compté. */
function countLabel(kind: string, count: number): string {
  const plural = count > 1;
  if (kind === 'technique') return `${count} exercice${plural ? 's' : ''}`;
  return `${count} morceau${plural ? 'x' : ''}`;
}

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
              `${countLabel(run.kind, run.songCount)}. ` +
              'Les évaluations éventuelles sont enregistrées, la synchro est à jour.'
          : 'Rien n’a été travaillé — rien n’a été enregistré.',
      ),
      backHome(),
    ),
  );
}

function backHome(): HTMLElement {
  const button = el(
    'button',
    { type: 'button', class: ui.icon, 'aria-label': 'Retour au répertoire' },
    '←',
  );
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

/** Habille une page de premier niveau de la navigation par sections. */
function shell(active: Section): HTMLElement {
  return mountSectionShell(root!, {
    active,
    hasTechnique: exercices.length > 0,
    techniqueDue: techniqueDueToday(progress),
  });
}

function render(): void {
  teardown?.();
  teardown = null;
  paintDemoBanner();

  const hash = window.location.hash || '#/';

  // Passerelle d'accueil : tant qu'aucun choix n'est fait, elle passe avant tout.
  const account = accountMode();
  if (account === 'none' || hash === '#/compte') {
    const wasGate = account === 'none';
    teardown = renderAccount(wasGate ? root! : shell('compte'), {
      gate: wasGate,
      progress: wasGate ? null : progress,
      songs,
      onChange: () => {
        progress = loadProgress();
        // Un identifiant vient d'être saisi/créé depuis la page compte : on
        // ramène l'utilisateur au répertoire plutôt que de rester sur « Compte ».
        if (hash === '#/compte' && accountMode() !== 'none') {
          navigate('#/');
        } else if (wasGate && !hasCompletedOnboarding()) {
          navigate('#/onboarding');
        } else {
          render();
        }
      },
      // Hors passerelle, la navigation par sections tient lieu de retour.
      navigateHome: null,
    });
    return;
  }

  // Grandfathering : quiconque atteint ce point avait déjà un compte résolu
  // avant l'apparition de l'assistant — on ne l'interrompt jamais après coup.
  if (!hasCompletedOnboarding() && hash !== '#/onboarding') {
    markOnboardingComplete();
  }

  if (hash === '#/onboarding') {
    teardown = renderOnboarding(root!, {
      songs,
      onComplete: (values) => {
        progress.settings.instrumentDefault = values.instrumentDefault;
        progress.settings.display = values.display;
        progress.settings.contrechant = values.contrechant;
        saveProgress(progress);
        markOnboardingComplete();
        navigate('#/');
      },
    });
    return;
  }

  if (hash === '#/demo') {
    teardown = renderDemo(root!, { songs, navigate });
    // `seedDemoProgress` (dans `renderDemo`) vient d'écrire dans
    // `sessionStorage` : sans ce rechargement, `progress` garderait la vraie
    // progression chargée au démarrage, et les écrans suivants (`#/song/:id`)
    // ne verraient jamais les données de démo.
    progress = loadProgress();
    paintDemoBanner();
    return;
  }

  if (hash === '#/aide') {
    teardown = renderAbout(shell('aide'));
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
        ? `Révision des urgences · ${session.setlistName} — morceau ${position} sur ${session.blocks.length}`
        : `Travail de fond · ${session.setlistName} — morceau ${position} sur ${session.order.length}`;
    const total = session.kind === 'urgent' ? session.blocks.length : session.order.length;
    const caption = {
      kind: session.kind === 'urgent' ? 'Urgences' : 'Travail de fond',
      position: `${position} sur ${total}`,
    };
    teardown = renderTrainer(root!, ordered, {
      progress,
      player,
      navigateHome: goHome,
      session: {
        kind: session.kind,
        label,
        caption,
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
      progress,
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

  if (hash === '#/technique' && exercices.length > 0) {
    teardown = renderTechniqueListe(shell('technique'), {
      progress,
      cartes: exercices,
      onStart: startTechnique,
      onStartTonalite: startTechniqueTonalite,
    });
    return;
  }

  if (hash === '#/technique/run' && technique) {
    teardown = renderTechnique(root!, {
      progress,
      ordre: technique.ordre,
      markWorked: (id) => technique?.worked.add(id),
      navigateBack: () => navigate('#/technique'),
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

  teardown = renderDashboard(shell('repertoire'), songs, {
    progress,
    openSong: (songId) => navigate(`#/song/${songId}`),
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

  // Le catalogue d'arpèges est facultatif : son absence ou une erreur de
  // lecture masque simplement la section, elle n'empêche pas de démarrer.
  try {
    exercices = await chargerCatalogue(new AbortController().signal);
  } catch {
    exercices = [];
  }

  initAnalytics();

  // Synchro entre appareils (silencieuse si aucun code n'est renseigné).
  initSync(() => {
    const fresh = loadProgress();
    if (isLiveActivityRoute(window.location.hash)) {
      // On met à jour l'objet en place (même référence) pour que la vue
      // active en tienne compte à sa prochaine écriture, sans la démonter.
      Object.assign(progress, fresh);
      return;
    }
    progress = fresh;
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
