/** Écran d'entraînement : partition à trous, et barre de transport fixe.
 *
 * La partition occupe tout l'espace et défile librement ; le pilotage vit dans
 * une barre qui ne disparaît jamais. Tout est atteignable au doigt : il n'y a
 * aucun raccourci clavier, et aucune action n'est cachée.
 */

import { el, ui } from '../dom';
import { EclipseRunner } from '../eclipse';
import { GrilleView } from '../grille';
import { ScoreView } from '../score';
import { BlockTimer, formatCountdown } from '../session';
import { createControlBar } from '../sheet';
import { review, statusOf, STATUS_LABELS } from '../srs';
import type { Progress } from '../store';
import { getCard, putCard, saveProgress } from '../store';
import { createTransport } from '../transport';
import type { Section } from '../transport';
import type {
  DisplayMode,
  EclipseIntensity,
  Grille,
  InstrumentId,
  MaskLevel,
  Song,
  StudyMode,
} from '../types';
import { isGrille } from '../types';
import {
  ECLIPSE_INTENSITIES,
  ECLIPSE_LABELS,
  MASK_LEVELS,
  STUDY_MODE_HINTS,
  STUDY_MODE_LABELS,
  STUDY_MODES,
} from '../types';
import { formatTime, Player } from '../youtube';
import { askSrs } from './srsModal';

export interface TrainerContext {
  progress: Progress;
  player: Player;
  navigateHome: () => void;
  /** Fourni uniquement pendant une séance de travail. */
  session?: {
    kind: 'deep' | 'urgent';
    /** Texte du bandeau (« … — bloc 2 sur 6 » ou « … — morceau 3 sur 8 »). */
    label: string;
    /** Minutes par bloc, ou `null` pour le travail de fond (pas de minuteur). */
    blockMinutes: number | null;
    /** Évaluer le morceau courant puis passer au suivant. */
    onBlockEnd: () => void;
    /** Terminer la séance maintenant (après évaluation du morceau courant). */
    onStopSession: () => void;
  };
}

export function renderTrainer(
  root: HTMLElement,
  song: Song,
  context: TrainerContext,
): () => void {
  const { progress, player } = context;

  // --- État local de l'écran ---------------------------------------------
  let instrumentId: InstrumentId = song.instruments[0]!.id;
  let hints = 0;
  let mode: StudyMode = progress.settings.studyMode;
  let maskLevel: MaskLevel = progress.settings.maskLevel;
  /** Zone d'étude voulue ; la grille n'est servie qu'une fois chargée. */
  let display: DisplayMode = progress.settings.display;
  let grille: Grille | null = null;

  const anySource = song.audio.reference !== null || song.audio.playback !== null;

  const currentInstrument = () =>
    song.instruments.find((instrument) => instrument.id === instrumentId)!;

  /** La graine n'avance que sur « Mélanger » : le motif est sinon stable. */
  const maskSeed = () =>
    `${song.id}::${instrumentId}::${progress.settings.maskSeed}`;

  // --- Partition et grille ---------------------------------------------

  const onHintUsed = (): void => {
    hints += 1;
    paintCounters();
  };

  const scoreContainer = el('div', { class: 'score-surface flex flex-col gap-6' });
  const scoreView = new ScoreView(scoreContainer, { onHintUsed });

  const grilleContainer = el('div', { class: 'hidden' });
  const grilleView = new GrilleView(grilleContainer, { onHintUsed });

  /** La grille est-elle disponible pour ce morceau ? */
  const grilleReady = (): boolean => grille !== null;
  /** Vue effectivement montrée : la grille demande d'être chargée. */
  const activeDisplay = (): DisplayMode =>
    display === 'grille' && grilleReady() ? 'grille' : 'partition';
  const activeView = (): ScoreView | GrilleView =>
    activeDisplay() === 'grille' ? grilleView : scoreView;
  const activeContainer = (): HTMLElement =>
    activeDisplay() === 'grille' ? grilleContainer : scoreContainer;

  const countersLabel = el('p', { class: 'text-[11px] text-zinc-500' });
  function paintCounters(): void {
    if (mode === 'mesures') {
      const onGrille = activeDisplay() === 'grille';
      const masked = activeView().maskedCount;
      const noun = onGrille ? 'accord' : 'mesure';
      const hidden = onGrille ? 'caché' : 'cachée';
      const shown = onGrille ? 'révélé' : 'révélée';
      countersLabel.textContent =
        `${masked} ${noun}${masked > 1 ? 's' : ''} ${hidden}${masked > 1 ? 's' : ''} · ` +
        `${hints} ${shown}${hints > 1 ? 's' : ''}`;
    } else if (mode === 'eclipses') {
      const n = eclipses.count;
      countersLabel.textContent =
        `${n} éclipse${n > 1 ? 's' : ''} · ${eclipses.escapeCount} interrompue` +
        `${eclipses.escapeCount > 1 ? 's' : ''}`;
    } else {
      countersLabel.textContent = '';
    }
  }

  /** Taux de masquage effectif : seul le mode « Mesures cachées » en pose un. */
  const effectiveLevel = () => (mode === 'mesures' ? maskLevel : 0);

  function drawScore(): void {
    // « Sans partition » ne masque pas à 100 % : il ne rend rien, donc il ne
    // laisse aucune tentation ni aucun temps de chargement d'images.
    if (mode === 'sans') {
      scoreView.destroy();
      grilleView.destroy();
      scoreContainer.classList.add('hidden');
      grilleContainer.classList.add('hidden');
      paintCounters();
      return;
    }
    const onGrille = activeDisplay() === 'grille';
    if (onGrille) {
      scoreView.destroy();
      grilleView.render(currentInstrument(), maskSeed(), effectiveLevel());
    } else {
      grilleView.destroy();
      scoreView.render(currentInstrument(), maskSeed(), effectiveLevel());
    }
    scoreContainer.classList.toggle('hidden', onGrille);
    grilleContainer.classList.toggle('hidden', !onGrille);
    paintCounters();
  }

  // --- Éclipses -----------------------------------------------------------

  const eclipseCount = el('div', {
    class: 'text-8xl font-bold tabular-nums text-amber-300',
  });
  const revealButton = el('button', { type: 'button', class: ui.button }, '👁 Revoir la partition');

  // Le voile passe sous le dock de transport (z-30) : on garde la main sur la
  // lecture et sur les réglages pendant qu'on est privé de la partition.
  const eclipseVeil = el(
    'div',
    {
      class:
        'fixed inset-0 z-20 hidden flex-col items-center justify-center gap-5 ' +
        'bg-zinc-950/95 backdrop-blur-md',
    },
    eclipseCount,
    el(
      'p',
      { class: 'max-w-xs text-center text-sm text-zinc-400' },
      'Continuez à jouer — la partition revient toute seule.',
    ),
    revealButton,
  );

  const eclipses = new EclipseRunner({
    intensity: progress.settings.eclipseIntensity,
    // Sans cette garde, une éclipse tomberait pendant qu'on règle la vitesse,
    // l'instrument posé. Un morceau sans bande-son n'a rien à attendre.
    isActive: () => mode === 'eclipses' && (!anySource || player.isPlaying()),
    onHide: () => {
      eclipseVeil.classList.remove('hidden');
      eclipseVeil.classList.add('flex');
      paintCounters();
    },
    onCountdown: (remaining) => {
      eclipseCount.textContent = String(remaining);
    },
    onShow: () => {
      eclipseVeil.classList.add('hidden');
      eclipseVeil.classList.remove('flex');
      paintCounters();
    },
  });
  revealButton.addEventListener('click', () => eclipses.revealNow());

  // --- Plein écran de la partition --------------------------------------
  //
  // Un mode lecture : la partition prend tout l'écran. On règle son
  // agrandissement, on la met en une ou deux colonnes (écran large), et l'on
  // peut réduire la barre de transport à un lecteur minimal. On y entre et
  // on en sort d'un bouton — ou avec Échap. Le voile des éclipses (z-20)
  // reste au-dessus de tout.

  const fpPrefs = progress.settings.fullpage;
  const FP_ZOOM_MIN = 0.4;
  const FP_ZOOM_MAX = 3;
  const FP_ZOOM_STEP = 0.2;
  const fpWide = window.matchMedia('(min-width: 1024px)');

  let fullpage = false;
  let fpZoom = fpPrefs.zoom;
  let fpTwoCol = fpPrefs.twoColumns;
  let fpPlayerHidden = anySource && fpPrefs.playerHidden;

  const fpIconButton = (glyph: string, aria: string): HTMLButtonElement =>
    el('button', { type: 'button', class: ui.icon, 'aria-label': aria }, glyph);

  const fullpageEnter = el(
    'button',
    { type: 'button', class: ui.button, 'aria-pressed': 'false' },
    '⛶ Plein écran',
  );

  // Bascule Partition / Grille : masquée tant que le morceau n'a pas de grille.
  const displayButtons = new Map<DisplayMode, HTMLButtonElement>();
  for (const value of ['partition', 'grille'] as DisplayMode[]) {
    const button = el(
      'button',
      { type: 'button', class: ui.button },
      value === 'partition' ? 'Partition' : 'Grille',
    );
    button.addEventListener('click', () => setDisplay(value));
    displayButtons.set(value, button);
  }
  const displayToggle = el('div', { class: 'hidden gap-1' }, ...displayButtons.values());

  const scoreHeaderRow = el(
    'div',
    { class: 'flex flex-wrap items-center justify-between gap-2' },
    displayToggle,
    fullpageEnter,
  );

  // Même bascule, format compact, pour la barre du plein écran.
  const fpDisplayButtons = new Map<DisplayMode, HTMLButtonElement>();
  for (const value of ['partition', 'grille'] as DisplayMode[]) {
    const button = el(
      'button',
      { type: 'button', class: ui.chip },
      value === 'partition' ? 'Part.' : 'Grille',
    );
    button.addEventListener('click', () => setDisplay(value));
    fpDisplayButtons.set(value, button);
  }
  const fpDisplayToggle = el(
    'div',
    { class: 'hidden items-center gap-1' },
    ...fpDisplayButtons.values(),
  );

  function paintDisplayToggle(): void {
    const has = grilleReady();
    displayToggle.classList.toggle('hidden', !has);
    displayToggle.classList.toggle('flex', has);
    fpDisplayToggle.classList.toggle('hidden', !has);
    fpDisplayToggle.classList.toggle('flex', has);
    const active = activeDisplay();
    for (const [value, button] of displayButtons) {
      button.className = value === active ? ui.buttonActive : ui.button;
    }
    for (const [value, button] of fpDisplayButtons) {
      button.className = value === active ? ui.chipActive : ui.chip;
    }
  }

  const fullpageExit = el('button', { type: 'button', class: ui.button }, '✕ Fermer');

  const fpZoomOut = fpIconButton('−', 'Réduire la partition');
  const fpZoomIn = fpIconButton('+', 'Agrandir la partition');
  const fpZoomLabel = el(
    'button',
    {
      type: 'button',
      class: ui.chip,
      'aria-label': 'Taille de la partition — toucher pour revenir à 100 %',
    },
    '100 %',
  );

  const fpColumns = fpIconButton('▥', 'Une ou deux colonnes');
  const fpColumnsSlot = el('div', { class: 'hidden' }, fpColumns);

  const fpPlayerToggle = fpIconButton('▾', 'Réduire le lecteur');
  if (!anySource) fpPlayerToggle.classList.add('hidden');

  const fullpageBar = el(
    'div',
    {
      class:
        'flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 ' +
        'bg-zinc-950 px-3 py-2 [padding-top:calc(env(safe-area-inset-top)+0.5rem)]',
    },
    fullpageExit,
    el('span', { class: 'min-w-0 flex-1 truncate text-sm text-zinc-500' }, song.title),
    fpDisplayToggle,
    fpZoomOut,
    fpZoomLabel,
    fpZoomIn,
    fpColumnsSlot,
    fpPlayerToggle,
  );

  const fullpageSlot = el('div', { class: 'fp-slot p-2 pb-40 sm:p-4' });
  const fullpageScroll = el(
    'div',
    { class: 'flex-1 overflow-auto overscroll-contain' },
    fullpageSlot,
  );
  const fullpageOverlay = el(
    'div',
    { class: 'fixed inset-0 z-10 hidden flex-col bg-zinc-950' },
    fullpageBar,
    fullpageScroll,
  );

  // Lecteur minimal, visible seulement quand la barre complète est réduite.
  const fpMiniIcon = el('span', { class: 'text-lg leading-none' }, '▶');
  const fpMiniPlay = el(
    'button',
    {
      type: 'button',
      class:
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 ' +
        'pl-0.5 text-zinc-950',
      'aria-label': 'Lecture ou pause',
    },
    fpMiniIcon,
  );
  fpMiniPlay.addEventListener('click', () => player.togglePlay());
  const fpMiniTime = el('span', { class: 'font-mono text-xs text-zinc-300' }, '0:00');
  const fpMiniExpand = fpIconButton('▴', 'Rouvrir le lecteur complet');
  const fpMiniBar = el(
    'div',
    {
      class:
        'pointer-events-auto fixed right-0 bottom-0 z-30 m-3 hidden items-center gap-2 ' +
        'rounded-full border border-zinc-700 bg-zinc-900/95 py-1.5 pr-2 pl-1.5 shadow-lg ' +
        'shadow-black/40 backdrop-blur ' +
        '[margin-bottom:calc(env(safe-area-inset-bottom)+0.75rem)]',
    },
    fpMiniPlay,
    fpMiniTime,
    fpMiniExpand,
  );

  const fpTickUnsub = player.onTick((tick) => {
    fpMiniIcon.textContent = tick.playing ? '❚❚' : '▶';
    fpMiniTime.textContent = `${formatTime(tick.currentTime)} / ${formatTime(tick.duration)}`;
  });

  /** Là où partition et grille vivent hors du plein écran, avec leur en-tête. */
  const scoreHome = el(
    'div',
    { class: 'flex flex-col gap-3' },
    scoreHeaderRow,
    scoreContainer,
    grilleContainer,
  );

  function applyFpLayout(): void {
    const cs = getComputedStyle(fullpageSlot);
    const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
    const cols = fpTwoCol && fpWide.matches ? 2 : 1;
    const gap = 16;
    // -1 px de marge : au facteur 1, deux pages plus la gouttière doivent tenir
    // dans la largeur sans forcer un retour à la ligne (arrondis, sous-pixels).
    const avail = Math.max(200, fullpageScroll.clientWidth - pad - 1);
    const colWidth = (avail - (cols - 1) * gap) / cols;
    const pageWidth = Math.max(140, Math.floor(colWidth * fpZoom));
    fullpageSlot.style.setProperty('--fp-page', `${pageWidth}px`);
    // La grille n'a pas de largeur d'image à suivre : elle grandit par sa
    // taille de police, pilotée par le même facteur de zoom.
    fullpageSlot.style.setProperty('--fp-zoom', String(fpZoom));
    fpZoomLabel.textContent = `${Math.round(fpZoom * 100)} %`;
    fpZoomOut.disabled = fpZoom <= FP_ZOOM_MIN + 1e-6;
    fpZoomIn.disabled = fpZoom >= FP_ZOOM_MAX - 1e-6;
    fpColumns.className = cols === 2 ? ui.iconActive : ui.icon;
  }

  function saveFp(): void {
    fpPrefs.zoom = fpZoom;
    fpPrefs.twoColumns = fpTwoCol;
    fpPrefs.playerHidden = fpPlayerHidden;
    saveProgress(progress);
  }

  function setFpZoom(next: number): void {
    fpZoom = Math.min(FP_ZOOM_MAX, Math.max(FP_ZOOM_MIN, Math.round(next * 100) / 100));
    applyFpLayout();
    saveFp();
  }
  fpZoomOut.addEventListener('click', () => setFpZoom(fpZoom - FP_ZOOM_STEP));
  fpZoomIn.addEventListener('click', () => setFpZoom(fpZoom + FP_ZOOM_STEP));
  fpZoomLabel.addEventListener('click', () => setFpZoom(1));
  fpColumns.addEventListener('click', () => {
    fpTwoCol = !fpTwoCol;
    applyFpLayout();
    saveFp();
  });

  function applyFpPlayer(): void {
    const mini = fullpage && fpPlayerHidden;
    controlBar.root.classList.toggle('hidden', mini);
    fpMiniBar.classList.toggle('hidden', !mini);
    fpMiniBar.classList.toggle('flex', mini);
    fpPlayerToggle.textContent = fpPlayerHidden ? '▴' : '▾';
    fpPlayerToggle.className = `${fpPlayerHidden ? ui.iconActive : ui.icon}${
      anySource ? '' : ' hidden'
    }`;
    fpPlayerToggle.setAttribute(
      'aria-label',
      fpPlayerHidden ? 'Rouvrir le lecteur complet' : 'Réduire le lecteur',
    );
  }
  function setFpPlayer(shown: boolean): void {
    fpPlayerHidden = anySource && !shown;
    applyFpPlayer();
    saveFp();
  }
  fpPlayerToggle.addEventListener('click', () => setFpPlayer(fpPlayerHidden));
  fpMiniExpand.addEventListener('click', () => setFpPlayer(true));

  function setFullpage(on: boolean): void {
    if (on === fullpage) return;
    if (on && mode === 'sans') return;
    fullpage = on;
    fullpageEnter.setAttribute('aria-pressed', String(on));
    document.body.style.overflow = on ? 'hidden' : '';
    fullpageOverlay.classList.toggle('hidden', !on);
    fullpageOverlay.classList.toggle('flex', on);
    if (on) {
      fullpageSlot.replaceChildren(activeContainer());
      applyFpLayout();
      // Le conteneur vient d'apparaître : sa largeur n'est fiable qu'une fois
      // la mise en page passée. On recalcule à la frame suivante.
      requestAnimationFrame(applyFpLayout);
      fullpageScroll.scrollTo(0, 0);
      fullpageExit.focus();
    } else {
      // On rend les deux conteneurs à `scoreHome` sans les redessiner, et l'on
      // remet les classes `hidden` selon la vue active.
      scoreHome.append(scoreContainer, grilleContainer);
      const onGrille = activeDisplay() === 'grille';
      scoreContainer.classList.toggle('hidden', onGrille);
      grilleContainer.classList.toggle('hidden', !onGrille);
    }
    applyFpPlayer();
  }
  fullpageEnter.addEventListener('click', () => setFullpage(true));
  fullpageExit.addEventListener('click', () => setFullpage(false));

  const onFullpageKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && fullpage) setFullpage(false);
  };
  window.addEventListener('keydown', onFullpageKey);

  const onFpViewport = (): void => {
    fpColumnsSlot.classList.toggle('hidden', !fpWide.matches);
    if (fullpage) applyFpLayout();
  };
  fpWide.addEventListener('change', onFpViewport);
  window.addEventListener('resize', onFpViewport);

  /** Rien à afficher en « Sans partition » : l'en-tête disparaît. */
  function paintFullpage(): void {
    scoreHeaderRow.classList.toggle('hidden', mode === 'sans');
    if (mode === 'sans') setFullpage(false);
    onFpViewport();
    applyFpPlayer();
  }

  // --- Comment travailler --------------------------------------------------

  const modeButtons = new Map<StudyMode, HTMLButtonElement>();
  const maskButtons = new Map<MaskLevel, HTMLButtonElement>();
  const intensityButtons = new Map<EclipseIntensity, HTMLButtonElement>();

  const maskRow = el('div', { class: 'flex flex-wrap items-center gap-2' });
  const intensityRow = el('div', { class: 'flex flex-wrap gap-2' });
  const modeHint = el('p', { class: 'text-xs leading-snug text-zinc-500' });

  /** Réglage fin d'un mode : caché tant que ce mode n'est pas retenu. */
  const subPanel = (label: string, row: HTMLElement): HTMLElement =>
    el(
      'div',
      { class: 'flex hidden flex-col gap-2 rounded-lg bg-zinc-800/40 p-3' },
      el('p', { class: 'text-[11px] font-medium uppercase tracking-wide text-zinc-500' }, label),
      row,
    );
  const maskPanel = subPanel('Proportion de mesures cachées', maskRow);
  const intensityPanel = subPanel('Fréquence des éclipses', intensityRow);

  /**
   * N'affiche que le réglage du mode retenu. C'est ce qui allège le plus le
   * panneau : on ne voit jamais les commandes d'un mode qu'on n'utilise pas.
   */
  function paintMode(): void {
    for (const [value, button] of modeButtons) {
      button.className = `${value === mode ? ui.buttonActive : ui.button} w-full`;
    }
    for (const [level, button] of maskButtons) {
      button.className = level === maskLevel ? ui.buttonActive : ui.button;
    }
    for (const [value, button] of intensityButtons) {
      button.className =
        value === progress.settings.eclipseIntensity ? ui.buttonActive : ui.button;
    }
    maskPanel.classList.toggle('hidden', mode !== 'mesures');
    intensityPanel.classList.toggle('hidden', mode !== 'eclipses');
    modeHint.textContent = STUDY_MODE_HINTS[mode];
    paintCounters();
  }

  function setDisplay(next: DisplayMode): void {
    if (next === display) return;
    if (next === 'grille' && !grilleReady()) return;
    display = next;
    progress.settings.display = next;
    saveProgress(progress);
    hints = 0;
    if (fullpage) {
      // Le plein écran ne contient qu'un conteneur : on y place le nouvel
      // actif et on rend l'autre à `scoreHome`.
      const nextActive = activeContainer();
      const other = nextActive === scoreContainer ? grilleContainer : scoreContainer;
      scoreHome.append(other);
      fullpageSlot.replaceChildren(nextActive);
      applyFpLayout();
      requestAnimationFrame(applyFpLayout);
      fullpageScroll.scrollTo(0, 0);
    }
    drawScore();
    paintDisplayToggle();
    paintFullpage();
  }

  function setMode(next: StudyMode): void {
    if (next === mode) return;
    mode = next;
    progress.settings.studyMode = next;
    saveProgress(progress);
    hints = 0;
    eclipses.reset();
    if (mode === 'eclipses') eclipses.start();
    else eclipses.stop();
    drawScore();
    paintMode();
    paintNoScore();
    paintFullpage();
  }

  for (const value of STUDY_MODES) {
    const button = el(
      'button',
      { type: 'button', class: `${ui.button} w-full` },
      STUDY_MODE_LABELS[value],
    );
    button.addEventListener('click', () => setMode(value));
    modeButtons.set(value, button);
  }

  for (const level of MASK_LEVELS) {
    const button = el('button', { type: 'button', class: ui.button }, `${level} %`);
    button.addEventListener('click', () => {
      if (level === maskLevel) return;
      maskLevel = level;
      progress.settings.maskLevel = level;
      saveProgress(progress);
      paintMode();
      activeView().setLevel(level, currentInstrument());
      paintCounters();
    });
    maskButtons.set(level, button);
  }

  const shuffleButton = el(
    'button',
    { type: 'button', class: ui.button, title: 'Nouveau tirage des mesures cachées' },
    '🎲 Mélanger',
  );
  shuffleButton.addEventListener('click', () => {
    progress.settings.maskSeed += 1;
    saveProgress(progress);
    activeView().reshuffle(maskSeed(), currentInstrument());
    paintCounters();
  });
  maskRow.append(...maskButtons.values(), shuffleButton);

  for (const value of ECLIPSE_INTENSITIES) {
    const button = el('button', { type: 'button', class: ui.button }, ECLIPSE_LABELS[value]);
    button.addEventListener('click', () => {
      progress.settings.eclipseIntensity = value;
      saveProgress(progress);
      eclipses.setIntensity(value);
      paintMode();
    });
    intensityButtons.set(value, button);
  }
  intensityRow.append(...intensityButtons.values());

  const maskSection: Section = {
    title: 'Comment travailler',
    hint: 'Quatre paliers, du plus soutenu au plus exigeant.',
    body: el(
      'div',
      { class: 'flex flex-col gap-3' },
      el('div', { class: 'grid grid-cols-2 gap-2' }, ...modeButtons.values()),
      modeHint,
      maskPanel,
      intensityPanel,
      countersLabel,
    ),
  };

  // --- Lecteur et barre de transport --------------------------------------

  // L'iframe reste dans le document mais hors du champ de vision : c'est ce
  // qui permet de garder l'audio sans jamais montrer la vidéo.
  const playerMount = el('div', { class: 'yt-audio-only' });

  const transport = createTransport({
    song,
    player,
    onInstrument: (id) => {
      instrumentId = id;
      hints = 0;
      drawScore();
    },
  });

  const controlBar = createControlBar({
    primary: transport.primary,
    // « Comment travailler » vient en tête : c'est le choix qui structure la
    // séance, et le panneau défile — relégué en bas, il était hors d'atteinte.
    sections: [maskSection, ...transport.sections],
    panelPosition: progress.settings.panel,
    onPanelMoved: (panel) => {
      progress.settings.panel = panel;
      saveProgress(progress);
    },
  });

  // --- Évaluation ---------------------------------------------------------

  async function finish(endSession = false): Promise<void> {
    player.pause();
    const instrument = currentInstrument();
    // Selon le mode, « indices » et « mesures dérobées » ne désignent pas la
    // même chose ; le rapport des deux, lui, garde le même sens : la part des
    // fois où l'on a eu besoin de la partition.
    const [used, total] =
      mode === 'eclipses'
        ? [eclipses.escapeCount, eclipses.count]
        : mode === 'sans'
          ? [0, activeView().measureCount]
          : [hints, activeView().maskedCount];
    const answer = await askSrs(song.title, instrument.name, used, total);
    if (answer) {
      const card = review(
        getCard(progress, song.id, instrumentId),
        answer.grade,
        answer.tempo,
        answer.hints,
      );
      putCard(progress, song.id, instrumentId, card);
    }
    hints = 0;
    eclipses.reset();
    paintCounters();
    if (context.session) {
      if (endSession) context.session.onStopSession();
      else context.session.onBlockEnd();
    } else {
      context.navigateHome();
    }
  }

  const nextLabel = context.session
    ? context.session.kind === 'deep'
      ? 'Passer au morceau suivant'
      : 'Terminer ce bloc'
    : 'Terminer et évaluer';
  const finishButton = el('button', { type: 'button', class: ui.primary }, nextLabel);
  finishButton.addEventListener('click', () => void finish());

  const stopSessionButton = context.session
    ? el('button', { type: 'button', class: ui.button }, 'Terminer la séance')
    : null;
  stopSessionButton?.addEventListener('click', () => void finish(true));

  const backButton = el('button', { type: 'button', class: ui.button }, 'Retour');
  backButton.addEventListener('click', () => context.navigateHome());

  // --- Minuteur de bloc (mode « urgences » uniquement) -------------------

  const blockLabel = el('span', { class: 'font-mono text-amber-300' }, '');
  let timer: BlockTimer | null = null;
  const blockMinutes = context.session?.blockMinutes ?? null;
  if (blockMinutes !== null) {
    timer = new BlockTimer(
      (secondsLeft) => {
        blockLabel.textContent = formatCountdown(secondsLeft);
      },
      () => void finish(),
    );
    timer.start(blockMinutes);
  }

  // --- Assemblage ---------------------------------------------------------

  const status = statusOf(getCard(progress, song.id, instrumentId));

  const sessionBanner = context.session
    ? el(
        'div',
        {
          class:
            'flex flex-wrap items-center justify-between gap-3 rounded-xl border ' +
            'border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200',
        },
        el('p', {}, context.session.label),
        blockMinutes !== null ? el('p', {}, 'Temps restant : ', blockLabel) : null,
      )
    : null;

  const header = el(
    'header',
    { class: 'flex flex-wrap items-start justify-between gap-4' },
    el(
      'div',
      { class: 'min-w-0' },
      el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, song.title),
      el(
        'p',
        { class: 'text-sm text-zinc-400' },
        song.composer || 'Compositeur inconnu',
      ),
      el(
        'p',
        { class: 'text-xs text-zinc-600' },
        `${currentInstrument().name} · ${STATUS_LABELS[status]}`,
      ),
    ),
    el(
      'div',
      { class: 'flex flex-wrap gap-2' },
      backButton,
      stopSessionButton,
      finishButton,
    ),
  );

  const noAudio = !anySource
    ? el(
        'p',
        { class: `${ui.card} text-sm text-zinc-400` },
        'Aucune vidéo disponible pour ce morceau — l’entraînement sur partition ' +
          'reste utilisable.',
      )
    : null;

  const noScore = el(
    'p',
    { class: `${ui.card} hidden text-sm text-zinc-400` },
    'Sans partition : le morceau se travaille à l’oreille et de mémoire. ' +
      'Choisissez un autre mode dans les réglages pour la faire réapparaître.',
  );
  function paintNoScore(): void {
    noScore.classList.toggle('hidden', mode !== 'sans');
  }

  root.replaceChildren(
    el(
      'div',
      {
        // La réserve en bas laisse la dernière page atteignable au-dessus de
        // la barre de transport, qui flotte par-dessus le flux.
        class: 'mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 pb-32 lg:pb-36',
      },
      playerMount,
      sessionBanner,
      header,
      noAudio,
      noScore,
      scoreHome,
    ),
    controlBar.root,
    fullpageOverlay,
    fpMiniBar,
    eclipseVeil,
  );

  drawScore();
  paintMode();
  paintNoScore();
  paintDisplayToggle();
  paintFullpage();
  if (mode === 'eclipses') eclipses.start();

  // Grille d'accords du morceau, si elle existe. Tant qu'elle n'est pas là, la
  // bascule « Grille » reste masquée et seule la partition est proposée.
  const grilleAbort = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`data/grilles/${song.id}.json`, {
        signal: grilleAbort.signal,
      });
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (!isGrille(data)) return;
      grille = data;
      grilleView.setGrille(grille);
      paintDisplayToggle();
      if (display === 'grille') {
        drawScore();
        paintFullpage();
        if (fullpage) {
          fullpageSlot.replaceChildren(activeContainer());
          applyFpLayout();
        }
      }
    } catch {
      /* réseau coupé, JSON invalide ou écran démonté : pas de grille */
    }
  })();

  // Le lecteur ne peut être monté qu'une fois son conteneur dans le document.
  if (anySource) {
    void (async () => {
      try {
        await player.mount(playerMount);
        transport.loadSource();
      } catch {
        noScore.before(
          el(
            'p',
            { class: `${ui.card} text-sm text-zinc-500` },
            'Lecteur YouTube indisponible (connexion ou blocage réseau).',
          ),
        );
      }
    })();
  }

  // Fonction de démontage, appelée par le routeur au changement d'écran.
  return () => {
    timer?.stop();
    eclipses.stop();
    player.clearCountdown();
    window.removeEventListener('keydown', onFullpageKey);
    window.removeEventListener('resize', onFpViewport);
    fpWide.removeEventListener('change', onFpViewport);
    fpTickUnsub();
    document.body.style.overflow = '';
    transport.destroy();
    controlBar.destroy();
    scoreView.destroy();
    grilleAbort.abort();
    grilleView.destroy();
  };
}
