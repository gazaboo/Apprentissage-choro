/** Écran d'entraînement : partition à trous, et barre de transport fixe.
 *
 * La partition occupe tout l'espace et défile librement ; le pilotage vit dans
 * une barre qui ne disparaît jamais. Tout est atteignable au doigt : il n'y a
 * aucun raccourci clavier, et aucune action n'est cachée.
 */

import { createInstrumentChip, createSegmented, el, iconLabel, paintToggle, ui } from '../dom';
import { EclipseRunner } from '../eclipse';
import { GrilleView } from '../grille';
import { ScoreView } from '../score';
import { BlockTimer, formatCountdown } from '../session';
import { createControlBar } from '../sheet';
import { recommendedMode, review, statusOf, STATUS_LABELS } from '../srs';
import type { Progress } from '../store';
import { getCard, putCard, saveProgress } from '../store';
import { createTransport } from '../transport';
import type { Section } from '../transport';
import type {
  DisplayMode,
  Grille,
  Instrument,
  InstrumentId,
  MaskLevel,
  Song,
  StudyMode,
} from '../types';
import { isGrille } from '../types';
import { MASK_LEVELS, STUDY_MODE_HINTS } from '../types';
import { formatTime, Player } from '../audio';
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
  let instrumentId: InstrumentId =
    song.instruments.find((i) => i.id === progress.settings.instrumentDefault)?.id ??
    song.instruments[0]!.id;
  let hints = 0;
  /** Nombre de fois où l'écran Consigne a été sollicité pour révéler la
   *  partition (mode « Sans partition » recommandé) — jamais compté comme un
   *  indice classique, mais plafonne la note suggérée en fin de morceau. */
  let aides = 0;
  /** Mode recommandé d'après l'historique du morceau (#109) : la partition ne
   *  se cache que si elle a déjà été maîtrisée plusieurs fois de suite, jamais
   *  sur un morceau nouveau ou juste après un échec. L'écran Consigne explique
   *  ce choix et reste réversible d'un clic — ce qui répond à la crainte de #8
   *  (arriver en plein défi sans comprendre pourquoi ni comment en sortir). */
  let mode: StudyMode = recommendedMode(getCard(progress, song.id, instrumentId));
  let maskLevel: MaskLevel = progress.settings.maskLevel;
  /** Zone d'étude voulue ; la grille n'est servie qu'une fois chargée. */
  let display: DisplayMode = progress.settings.display;
  let grille: Grille | null = null;
  /** Mélodie seule ou avec contre-chant ; sans effet hors Ut (#80). */
  let contrechant: 'avec' | 'sans' = progress.settings.contrechant;

  const anySource = song.audio.reference !== null || song.audio.playback !== null;

  /** Le contraponto n'existe qu'en Ut (V1, #80). */
  const contrechantAvailable = (): boolean =>
    instrumentId === 'c' && song.contraponto !== null;

  const currentInstrument = (): Instrument => {
    const base = song.instruments.find((instrument) => instrument.id === instrumentId)!;
    if (contrechantAvailable() && contrechant === 'avec' && song.contraponto) {
      return {
        ...base,
        page_count: song.contraponto.page_count,
        measure_count: song.contraponto.measure_count,
        pages: song.contraponto.pages,
      };
    }
    return base;
  };

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

  // Sans objet sur mobile : le plein écran n'apporte rien sur un écran déjà
  // plein (retour du 2026-09-23, #153) — seul le point d'entrée disparaît,
  // le mode plein écran lui-même (barre dédiée, sortie via Échap) reste
  // inchangé pour qui l'a ouvert avant un redimensionnement.
  const fullpageEnter = el(
    'button',
    {
      type: 'button',
      class: `${ui.button} max-md:hidden`,
      'aria-pressed': 'false',
      'aria-label': 'Passer en plein écran',
    },
    iconLabel('⛶', 'Plein écran'),
  );

  // Sélecteur d'affichage : un seul groupe Partition / Grille, et les
  // sous-options Mélodie qui se révèlent à côté quand Partition est choisie —
  // elles n'ont de sens que là (#137). Le même choix existe en double, ici et
  // dans la barre de plein écran ; `createSegmented` laisse la vue seule
  // source de vérité, si bien que les deux se repeignent depuis le même état.
  // Icône seule sur mobile plutôt que le texte abrégé de la barre de plein
  // écran, jugé incompréhensible (#150) — le desktop garde le texte complet.
  const displaySelector = createSegmented<DisplayMode>(
    [
      { value: 'partition', label: 'Partition', icon: '♪' },
      { value: 'grille', label: 'Grille', icon: '▦' },
    ],
    (value) => setDisplay(value),
  );
  const fpDisplaySelector = createSegmented<DisplayMode>(
    [
      { value: 'partition', label: 'Part.' },
      { value: 'grille', label: 'Grille' },
    ],
    (value) => setDisplay(value),
    { variant: 'chip' },
  );

  const contrechantSelector = createSegmented<'sans' | 'avec'>(
    [
      { value: 'sans', label: 'Mélodie', icon: '1' },
      { value: 'avec', label: '+ contre-chant', icon: '2' },
    ],
    (value) => setContrechant(value),
  );
  const fpContrechantSelector = createSegmented<'sans' | 'avec'>(
    [
      { value: 'sans', label: 'Mél.' },
      { value: 'avec', label: 'Mél.+CC' },
    ],
    (value) => setContrechant(value),
    { variant: 'chip' },
  );

  // Les sous-options poussent depuis la bascule principale au lieu
  // d'apparaître d'un coup : l'animation dit qu'elles en dépendent. Elle est
  // courte et neutralisée sous `prefers-reduced-motion` (voir `style.css`).
  // Masquée sur mobile (#153) : rejoint le tiroir Réglages sous forme de
  // libellés complets (`modeSection` plus bas) plutôt que les icônes "1"/"2"
  // jugées incompréhensibles sans essai-erreur.
  const contrechantReveal = el('div', { class: 'reveal-inline' }, contrechantSelector.root);
  // `.reveal-inline` impose `display: grid` à toutes les tailles (style.css) :
  // poser `max-md:hidden` directement dessus perd le duel de cascade contre
  // cette règle non conditionnelle. On l'enveloppe plutôt.
  const contrechantRevealSlot = el('div', { class: 'max-md:hidden' }, contrechantReveal);
  const fpContrechantReveal = el('div', { class: 'reveal-inline' }, fpContrechantSelector.root);

  // Choix de tonalité, en double comme le mode d'affichage ci-dessus : la
  // pastille cyclique reste dans l'en-tête desktop, une liste explicite
  // rejoint le tiroir Réglages pour mobile (`tonaliteSection` plus bas) — les
  // deux widgets se recopient l'un l'autre sans se rappeler l'un l'autre
  // (même doctrine que `Segmented`, #137).
  function pickInstrument(id: InstrumentId): void {
    instrumentId = id;
    hints = 0;
    drawScore();
    paintContrechantToggle();
    instrumentChip.set(id);
    drawerInstrumentSelector.set(id);
  }

  const instrumentChip = createInstrumentChip({
    instruments: song.instruments,
    current: instrumentId,
    onPick: pickInstrument,
    extra: 'max-md:hidden',
  });

  const drawerInstrumentSelector = createSegmented<InstrumentId>(
    song.instruments.map((instrument) => ({ value: instrument.id, label: instrument.name })),
    pickInstrument,
  );
  drawerInstrumentSelector.set(instrumentId);
  const tonaliteSection: Section = {
    title: 'Tonalité',
    hint: 'Transposition pour laquelle la partition s’affiche.',
    body: drawerInstrumentSelector.root,
    mobileOnly: true,
  };

  const drawerContrechantSelector = createSegmented<'sans' | 'avec'>(
    [
      { value: 'sans', label: 'Mélodie seule' },
      { value: 'avec', label: '+ contre-chant' },
    ],
    (value) => setContrechant(value),
  );
  const contrechantUnavailableHint = el(
    'p',
    { class: 'text-xs leading-relaxed text-zinc-500' },
    'Le contre-chant n’existe que pour la tonalité Ut, avec cette partition.',
  );
  const modeSection: Section = {
    title: 'Affichage de la partition',
    hint: 'Choisissez si le contre-chant s’ajoute à la mélodie.',
    body: el(
      'div',
      { class: 'flex flex-col gap-2' },
      drawerContrechantSelector.root,
      contrechantUnavailableHint,
    ),
    mobileOnly: true,
  };

  // Contrôles qui n'ont pas de sens sans partition à l'écran : ils
  // disparaissent en mode « Sans partition », alors que la pastille de
  // tonalité et l'ouvreur du Défi restent joignables (#109).
  const scoreControls = el(
    'div',
    { class: 'flex shrink-0 items-center gap-2' },
    displaySelector.root,
    contrechantRevealSlot,
    fullpageEnter,
  );

  function paintDisplayToggle(): void {
    const has = grilleReady();
    displaySelector.setVisible(has);
    fpDisplaySelector.setVisible(has);
    const active = activeDisplay();
    displaySelector.set(active);
    fpDisplaySelector.set(active);
  }

  /** Sans effet sur la grille : le contre-chant est un choix de rendu de la
   *  partition, absent de la grille d'accords (#98). */
  function paintContrechantToggle(): void {
    const has = contrechantAvailable() && activeDisplay() !== 'grille';
    contrechantReveal.classList.toggle('is-open', has);
    fpContrechantReveal.classList.toggle('is-open', has);
    drawerContrechantSelector.root.classList.toggle('hidden', !has);
    contrechantUnavailableHint.classList.toggle('hidden', has);
    contrechantSelector.set(contrechant);
    fpContrechantSelector.set(contrechant);
    drawerContrechantSelector.set(contrechant);
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

  // Repli du lecteur : réservé au plein écran, où gagner de la hauteur sur la
  // partition est tout l'objet du mode. Hors plein écran le dock est dans le
  // flux et ne recouvre plus rien — le replier n'apporte plus assez pour
  // justifier un contrôle de plus à comprendre (#132).
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
    fpDisplaySelector.root,
    fpContrechantReveal,
    fpZoomOut,
    fpZoomLabel,
    fpZoomIn,
    fpColumnsSlot,
    fpPlayerToggle,
  );

  const fullpageSlot = el('div', { class: 'fp-slot p-2 sm:p-4' });
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
    paintToggle(fpColumns, cols === 2, 'icon');
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
    // Le repli du lecteur vaut aussi bien en plein écran que hors plein écran
    // (issue #120) : le dock est le même nœud fixé en bas dans les deux cas.
    const mini = fpPlayerHidden;
    controlBar.root.classList.toggle('hidden', mini);
    fpMiniBar.classList.toggle('hidden', !mini);
    fpMiniBar.classList.toggle('flex', mini);
    fpPlayerToggle.textContent = fpPlayerHidden ? '▴' : '▾';
    paintToggle(fpPlayerToggle, fpPlayerHidden, 'icon', anySource ? '' : 'hidden');
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
      // Le dock n'est plus `fixed` : il ne flotte donc plus au-dessus de
      // l'overlay par z-index, il faut l'y déménager — comme on déménage déjà
      // le conteneur de partition. L'overlay étant `flex-col` avec
      // `fullpageScroll` en `flex-1`, il se pose au bas, dans le flux, sans
      // rien recouvrir là non plus.
      fullpageOverlay.append(controlBar.root);
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
      page.append(controlBar.root);
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

  /** En « Sans partition », les bascules d'en-tête n'ont plus de sens — le
   *  bouton Défi, lui, vit dans le dock (`sheet.ts`) et reste toujours
   *  joignable, quel que soit le mode (#109). */
  function paintFullpage(): void {
    scoreControls.classList.toggle('hidden', mode === 'sans');
    scoreControls.classList.toggle('flex', mode !== 'sans');
    if (mode === 'sans') setFullpage(false);
    onFpViewport();
    applyFpPlayer();
  }

  // --- Défi -----------------------------------------------------------------

  const defiButtons = new Map<MaskLevel | 'entiere', HTMLButtonElement>();
  const defiHint = el('p', { class: 'text-xs leading-snug text-zinc-500' });

  /** Reflète le niveau retenu dans la liste, et n'affiche « Mélanger » que
   *  pour le mode qu'il concerne. */
  function paintMode(): void {
    for (const [level, button] of defiButtons) {
      const active = level === 'entiere' ? mode === 'entiere' : mode === 'mesures' && level === maskLevel;
      paintToggle(button, active, 'button', 'w-full justify-start');
    }
    shuffleSlot.classList.toggle('hidden', mode !== 'mesures');
    defiHint.textContent = STUDY_MODE_HINTS[mode];
    paintCounters();
  }

  function setDisplay(next: DisplayMode): void {
    if (next === display) return;
    if (next === 'grille' && !grilleReady()) return;
    display = next;
    progress.settings.display = next;
    saveProgress(progress);
    hints = 0;
    aides = 0;
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
    paintContrechantToggle();
    paintFullpage();
  }

  function setContrechant(next: 'avec' | 'sans'): void {
    if (next === contrechant) return;
    contrechant = next;
    progress.settings.contrechant = next;
    saveProgress(progress);
    hints = 0;
    aides = 0;
    drawScore();
    paintContrechantToggle();
  }

  /**
   * `persist: false` (boutons d'aide de l'écran Consigne, feuille refermée
   * automatiquement) laisse `progress.settings.studyMode` intact : un coup
   * d'œil à la partition ne doit pas redéfinir la préférence par défaut de
   * l'application. Le bouton « Défi » (choix explicite) persiste, lui.
   *
   * La persistance est indépendante du early-return sur l'état local
   * (`mode` déjà en mémoire) : un choix explicite doit s'écrire même quand
   * il coïncide avec le mode courant *non encore persisté* (ex. mode
   * recommandé 'sans' au chargement, réglage persisté encore 'entiere') —
   * sinon un clic Défi qui « ne change rien à l'écran » resterait
   * silencieusement non enregistré (relecture #131).
   */
  function setMode(next: StudyMode, options: { persist?: boolean } = {}): void {
    const changed = next !== mode;
    mode = next;
    if (options.persist !== false) {
      progress.settings.studyMode = next;
      saveProgress(progress);
      // Un choix délibéré (dock, bouton Défi) repart de zéro ; une demande
      // d'aide (persist: false) ne doit pas s'effacer elle-même.
      aides = 0;
    }
    if (!changed) return;
    hints = 0;
    eclipses.reset();
    if (mode === 'eclipses') eclipses.start();
    else eclipses.stop();
    drawScore();
    paintMode();
    paintConsigne();
    paintFullpage();
  }

  /**
   * Échelle d'aide de l'écran Consigne : ne modifie jamais les réglages
   * persistés (`maskLevel`/`studyMode`), seulement l'état local de cet écran.
   * `aides` plafonne ensuite la note suggérée en fin de morceau (#109).
   */
  function applyAide(level: MaskLevel | 'entiere'): void {
    if (level === 'entiere') {
      setMode('entiere', { persist: false });
    } else {
      maskLevel = level;
      setMode('mesures', { persist: false });
      activeView().setLevel(level, currentInstrument());
    }
    aides += 1;
    paintCounters();
  }

  /**
   * Même échelle que `applyAide`, mais choix explicite du dock : persiste
   * `studyMode`/`maskLevel` (#109). Les deux fonctions n'écrivent jamais
   * dans la même variable partagée (`maskLevel`) sous une garde qui
   * comparerait à l'état local — chacune la met à jour sans condition, ce
   * qui évite l'interaction croisée relevée en relecture (#131).
   */
  function applyDefi(level: MaskLevel | 'entiere'): void {
    if (level === 'entiere') {
      setMode('entiere', { persist: true });
    } else {
      maskLevel = level;
      progress.settings.maskLevel = level;
      setMode('mesures', { persist: true });
      activeView().setLevel(level, currentInstrument());
    }
    paintMode();
  }

  // Même échelle, du palier le plus soutenu au plus exigeant, que les
  // boutons d'aide de l'écran Consigne (`aideButtons` ci-dessous) — mêmes
  // libellés, choix persistant plutôt que passager.
  for (const level of [...MASK_LEVELS].sort((a, b) => b - a)) {
    const button = el(
      'button',
      { type: 'button', class: ui.button },
      `Partition masquée à ${level} %`,
    );
    button.addEventListener('click', () => applyDefi(level));
    defiButtons.set(level, button);
  }
  const defiEntiereButton = el(
    'button',
    { type: 'button', class: ui.button },
    'Afficher la partition entière',
  );
  defiEntiereButton.addEventListener('click', () => applyDefi('entiere'));
  defiButtons.set('entiere', defiEntiereButton);

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
  // Enveloppe dédiée au masquage : `ui.button` impose `inline-flex`, qui
  // l'emporterait sur un `hidden` posé directement sur le bouton (même piège
  // que `toggleSlot` dans `sheet.ts`).
  const shuffleSlot = el('div', { class: 'hidden' }, shuffleButton);

  const defiSection: Section = {
    title: 'Défi',
    hint: 'Choix explicite : remplace votre réglage par défaut pour ce morceau.',
    body: el(
      'div',
      { class: 'flex flex-col gap-3' },
      el('div', { class: 'flex flex-col gap-2' }, ...defiButtons.values()),
      shuffleSlot,
      defiHint,
      countersLabel,
    ),
  };

  // --- Lecteur et barre de transport --------------------------------------

  // L'élément audio reste dans le document mais hors du champ de vision.
  const playerMount = el('div', { class: 'audio-only' });

  const transport = createTransport({ song, player });

  const controlBar = createControlBar({
    primary: transport.primary,
    // « Comment travailler » vient en tête : c'est le choix qui structure la
    // séance, et le panneau défile — relégué en bas, il était hors d'atteinte.
    // Tonalité et mode ne rejoignent le tiroir que sur mobile (`mobileOnly`) :
    // sur desktop, ils restent visibles en direct dans l'en-tête (#153).
    sections: [
      defiSection,
      tonaliteSection,
      ...(song.contraponto !== null ? [modeSection] : []),
      ...transport.sections,
    ],
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
    // Une partition rouverte via l'écran Consigne n'a pas valu un Again : on
    // plafonne juste la présélection, la note reste au choix de l'utilisateur.
    const answer = await askSrs(
      song.title,
      instrument.name,
      used,
      total,
      undefined,
      undefined,
      aides > 0 ? 3 : undefined,
    );
    // Annulation : ni note, ni changement de bloc/séance — on reste sur le morceau.
    if (answer === 'cancelled') return;
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
    aides = 0;
    eclipses.reset();
    paintCounters();
    if (context.session) {
      if (endSession) context.session.onStopSession();
      else context.session.onBlockEnd();
    } else {
      context.navigateHome();
    }
  }

  const nextLabel = context.session ? 'Passer au morceau suivant' : 'Terminer et évaluer';
  const nextIcon = context.session ? '⏭' : '✓';
  // Bouton ordinaire, et non `ui.primary` : sur cet écran l'action principale
  // est la lecture (le rond ambre du dock). Remplir « Terminer » en ambre en
  // faisait l'élément le plus voyant de la page, alors qu'on ne le touche
  // qu'une fois, à la fin (#137). Icône seule sur mobile : action de fin de
  // parcours, peu consultée en continu (#150).
  const finishButton = el(
    'button',
    { type: 'button', class: ui.button, 'aria-label': nextLabel },
    iconLabel(nextIcon, nextLabel),
  );
  finishButton.addEventListener('click', () => void finish());

  const stopSessionButton = context.session
    ? el(
        'button',
        { type: 'button', class: ui.button, 'aria-label': 'Terminer la séance' },
        iconLabel('⏹', 'Terminer la séance'),
      )
    : null;
  stopSessionButton?.addEventListener('click', () => void finish(true));

  const backButton = el(
    'button',
    { type: 'button', class: ui.button, 'aria-label': 'Retour' },
    iconLabel('←', 'Retour'),
  );
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

  // Pastille de contexte de séance : remplace l'ancien bandeau pleine
  // largeur (#107) — mêmes infos (libellé + temps restant), en ligne à côté
  // du titre plutôt que sur une rangée dédiée.
  const sessionBadge = context.session
    ? el(
        'span',
        {
          class:
            'inline-flex min-w-0 min-h-11 items-center gap-2 rounded-lg border ' +
            'border-amber-400/30 bg-amber-400/10 px-3 text-xs font-medium ' +
            'text-amber-200 max-md:min-h-8 max-md:px-2',
        },
        // Sur mobile, `min-w-0 flex-1` laisse le libellé se réduire à
        // l'espace réellement disponible plutôt qu'imposer un plancher fixe
        // de 14rem qui faisait déborder toute la page horizontalement dès
        // qu'un libellé de séance était un peu long (#150). Desktop inchangé
        // (`sm:max-w-none`, pas de troncature).
        el(
          'span',
          { class: 'min-w-0 flex-1 truncate sm:max-w-none sm:flex-none' },
          context.session.label,
        ),
        blockMinutes !== null
          ? el(
              'span',
              { class: 'flex items-center gap-1' },
              el('span', { class: 'sr-only' }, 'Temps restant : '),
              blockLabel,
            )
          : null,
      )
    : null;

  // L'état SRS devient une pastille collée au titre plutôt qu'un mot en
  // toutes lettres au même rang que lui : c'est une information de contexte,
  // pas un élément de la ligne principale (#137).
  const statusDot = el('span', {
    class:
      'h-2 w-2 shrink-0 rounded-full ' +
      (status === 'a-reviser'
        ? 'bg-amber-400'
        : status === 'jamais'
          ? 'bg-zinc-600'
          : 'bg-emerald-500'),
    title: STATUS_LABELS[status],
    'aria-label': STATUS_LABELS[status],
    role: 'img',
  });

  // La tonalité de référence ne figure plus dans le sous-titre : la pastille
  // de transposition, remontée du dock, *est* l'affichage de cette
  // information — et, contrairement au texte qu'elle remplace, elle se met à
  // jour quand on change de tonalité.
  const identity = el(
    'div',
    { class: 'flex min-w-0 flex-1 items-center gap-2' },
    el(
      'h1',
      {
        // Masqué visuellement sur mobile (reste le titre de page accessible) :
        // déjà imprimé sur la partition juste en dessous, la place revient
        // aux contrôles (retour du 2026-09-23, #153).
        class: 'min-w-0 truncate text-lg font-semibold text-zinc-100 max-md:sr-only',
        // Le compositeur passe en infobulle plutôt que sur la ligne : il est
        // déjà imprimé sur la partition juste en dessous, et la place de
        // cette ligne revient aux contrôles (#137).
        title: `${song.title} — ${song.composer || 'compositeur inconnu'}`,
      },
      song.title,
    ),
    statusDot,
    sessionBadge,
  );

  // Sur mobile, tous les contrôles secondaires sont compactés en icône seule
  // (`iconLabel`/`createSegmented` avec `icon`) pour tenir sur une seule
  // ligne sans défilement horizontal — un défilement masquait des boutons
  // sans indice qu'il fallait le faire (#150). Le desktop garde le texte
  // complet, `gap-2` suffit alors à tout faire tenir.
  const headerControls = el(
    'div',
    { class: 'flex shrink-0 items-center gap-1.5 md:gap-2' },
    scoreControls,
    instrumentChip.root,
    controlBar.opener,
  );

  const header = el(
    'header',
    {
      class:
        'dense-bar flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 max-md:gap-x-2',
    },
    backButton,
    identity,
    headerControls,
    el(
      'div',
      { class: 'flex shrink-0 gap-1.5 md:gap-2' },
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

  // Grands boutons tactiles : en « Sans partition », l'écran Consigne est le
  // seul contenu affiché (la partition et la grille restent masquées, cf.
  // `drawScore`) — autant lui donner tout l'espace laissé libre plutôt que de
  // le réduire à une petite carte. Utile en particulier instrument en main :
  // grandes cibles, peu de précision requise.
  const consigneButtonClass =
    'flex min-h-16 flex-1 basis-full items-center justify-center rounded-xl border ' +
    'border-zinc-700 bg-zinc-800 px-5 py-4 text-center text-base font-medium ' +
    'text-zinc-100 transition hover:border-amber-400/60 hover:bg-zinc-700 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ' +
    'sm:basis-[calc(50%-0.375rem)] sm:text-lg';

  // Échelle d'aide, du plus petit pas au plus grand — 75 % masqué est l'aide
  // *minimale* (une bonne part de la partition reste cachée), pas l'inverse.
  const aideButtons: HTMLButtonElement[] = [...MASK_LEVELS]
    .sort((a, b) => b - a)
    .map((level) => {
      const button = el(
        'button',
        { type: 'button', class: consigneButtonClass },
        `Partition masquée à ${level} %`,
      );
      button.addEventListener('click', () => applyAide(level));
      return button;
    });
  const aideEntiereButton = el(
    'button',
    { type: 'button', class: consigneButtonClass },
    'Afficher la partition entière',
  );
  aideEntiereButton.addEventListener('click', () => applyAide('entiere'));
  aideButtons.push(aideEntiereButton);

  const consigneHint = el('p', { class: 'max-w-xl text-base text-zinc-300 sm:text-lg' });
  // Padding propre (pas `ui.card`, dont le `p-4` fixe entrerait en
  // concurrence avec la respiration verticale voulue ici) : rond, bordé,
  // mais avec toute la place que laisse le mode « Sans partition » (aucune
  // partition ni grille à afficher, cf. `drawScore`).
  const consigne = el(
    'div',
    {
      class:
        'hidden min-h-[60vh] flex-1 flex-col items-center justify-center gap-5 ' +
        'rounded-xl border border-zinc-800 bg-zinc-900/60 px-6 py-10 text-center',
    },
    el('h2', { class: 'text-2xl font-semibold text-zinc-100 sm:text-3xl' }, 'Consigne'),
    consigneHint,
    el(
      'p',
      { class: 'text-xs text-zinc-500' },
      'Ce défi est réversible : touchez « 🎯 Défi » dans la barre du bas pour ' +
        'changer de mode à tout moment.',
    ),
    el(
      'p',
      { class: 'text-sm font-medium text-zinc-300 sm:text-base' },
      'Besoin d’aide ?',
    ),
    el('div', { class: 'flex w-full max-w-xl flex-wrap gap-3' }, ...aideButtons),
  );
  function paintConsigne(): void {
    const shown = mode === 'sans';
    consigne.classList.toggle('hidden', !shown);
    consigne.classList.toggle('flex', shown);
    consigneHint.textContent = STUDY_MODE_HINTS[mode];
  }

  // Coquille à trois bandes — barre du haut, zone de partition, dock — plutôt
  // qu'une page qui défile d'un bloc sous un dock flottant. C'est la seule
  // disposition où le dock ne recouvre *jamais* la partition : celle-ci
  // défile dans sa propre boîte (`flex-1 overflow-y-auto`), dimensionnée sur
  // ce qui reste. Un `sticky bottom-0` ne suffisait pas — il réserve bien la
  // place en fin de page, mais reste posé par-dessus pendant le défilement
  // (#9, #137).
  //
  // `min-h-0` est indispensable : sans lui, un enfant de flex refuse de
  // devenir plus court que son contenu et la boîte ne défile jamais.
  const scoreScroll = el(
    'div',
    { class: 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto' },
    noAudio,
    consigne,
    scoreHome,
  );
  const page = el(
    'div',
    {
      class:
        'mx-auto flex h-dvh max-w-5xl flex-col gap-4 px-4 py-6 max-md:gap-2 max-md:pb-0 max-md:pt-2',
    },
    playerMount,
    header,
    scoreScroll,
    controlBar.root,
  );

  root.replaceChildren(page, fullpageOverlay, fpMiniBar, eclipseVeil);

  drawScore();
  paintMode();
  paintConsigne();
  paintDisplayToggle();
  paintContrechantToggle();
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
      paintContrechantToggle();
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
  let playerNote: HTMLElement | null = null;
  const unsubscribeFailure = player.onFailure((failure) => {
    const message =
      failure === 'geste'
        ? 'Lecture bloquée par le navigateur — touchez ▶ pour démarrer.'
        : "Audio indisponible pour ce morceau (fichier manquant ou illisible).";
    if (playerNote) {
      playerNote.textContent = message;
      return;
    }
    playerNote = el('p', { class: `${ui.card} text-sm text-zinc-500` }, message);
    consigne.before(playerNote);
  });

  if (anySource) {
    void (async () => {
      await player.mount(playerMount);
      transport.loadSource();
    })();
  }

  // Fonction de démontage, appelée par le routeur au changement d'écran.
  return () => {
    timer?.stop();
    eclipses.stop();
    unsubscribeFailure();
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
