/** Écran d'entraînement : partition à trous, et barre de transport fixe.
 *
 * La partition occupe tout l'espace et défile librement ; le pilotage vit dans
 * une barre qui ne disparaît jamais. Tout est atteignable au doigt : il n'y a
 * aucun raccourci clavier, et aucune action n'est cachée.
 */

import { el, ui } from '../dom';
import { EclipseRunner } from '../eclipse';
import { ScoreView } from '../score';
import { BlockTimer, formatCountdown } from '../session';
import type { SessionBlock } from '../session';
import { createControlBar } from '../sheet';
import { review, statusOf, STATUS_LABELS } from '../srs';
import type { Progress } from '../store';
import { getCard, putCard, saveProgress } from '../store';
import { createTransport } from '../transport';
import type { Section } from '../transport';
import type { EclipseIntensity, InstrumentId, MaskLevel, Song, StudyMode } from '../types';
import {
  ECLIPSE_INTENSITIES,
  ECLIPSE_LABELS,
  MASK_LEVELS,
  STUDY_MODE_HINTS,
  STUDY_MODE_LABELS,
  STUDY_MODES,
} from '../types';
import { Player } from '../youtube';
import { askSrs } from './srsModal';

export interface TrainerContext {
  progress: Progress;
  player: Player;
  navigateHome: () => void;
  /** Fourni uniquement pendant une session entrelacée. */
  session?: {
    blocks: SessionBlock[];
    blockIndex: number;
    blockMinutes: number;
    onBlockEnd: () => void;
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

  const anySource = song.audio.reference !== null || song.audio.playback !== null;

  const currentInstrument = () =>
    song.instruments.find((instrument) => instrument.id === instrumentId)!;

  /** La graine n'avance que sur « Mélanger » : le motif est sinon stable. */
  const maskSeed = () =>
    `${song.id}::${instrumentId}::${progress.settings.maskSeed}`;

  // --- Partition ----------------------------------------------------------

  const scoreContainer = el('div', { class: 'score-surface flex flex-col gap-6' });
  const scoreView = new ScoreView(scoreContainer, {
    onHintUsed: () => {
      hints += 1;
      paintCounters();
    },
  });

  const countersLabel = el('p', { class: 'text-[11px] text-zinc-500' });
  function paintCounters(): void {
    if (mode === 'mesures') {
      const masked = scoreView.maskedCount;
      countersLabel.textContent =
        `${masked} mesure${masked > 1 ? 's' : ''} cachée${masked > 1 ? 's' : ''} · ` +
        `${hints} révélée${hints > 1 ? 's' : ''}`;
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
    // « Sans partition » ne masque pas à 100 % : il ne rend aucune page, donc
    // il ne laisse aucune tentation ni aucun temps de chargement d'images.
    if (mode === 'sans') {
      scoreView.destroy();
      paintCounters();
      return;
    }
    scoreView.render(currentInstrument(), maskSeed(), effectiveLevel());
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

  // --- Comment travailler --------------------------------------------------

  const modeButtons = new Map<StudyMode, HTMLButtonElement>();
  const maskButtons = new Map<MaskLevel, HTMLButtonElement>();
  const intensityButtons = new Map<EclipseIntensity, HTMLButtonElement>();

  const maskRow = el('div', { class: 'flex flex-wrap items-center gap-2' });
  const intensityRow = el('div', { class: 'flex flex-wrap gap-2' });
  const modeHint = el('p', { class: 'text-[11px] leading-snug text-zinc-500' });

  /**
   * N'affiche que le réglage du mode retenu. C'est ce qui allège le plus le
   * panneau : on ne voit jamais les commandes d'un mode qu'on n'utilise pas.
   */
  function paintMode(): void {
    for (const [value, button] of modeButtons) {
      button.className = value === mode ? ui.buttonActive : ui.button;
    }
    for (const [level, button] of maskButtons) {
      button.className = level === maskLevel ? ui.buttonActive : ui.button;
    }
    for (const [value, button] of intensityButtons) {
      button.className =
        value === progress.settings.eclipseIntensity ? ui.buttonActive : ui.button;
    }
    maskRow.classList.toggle('hidden', mode !== 'mesures');
    intensityRow.classList.toggle('hidden', mode !== 'eclipses');
    modeHint.textContent = STUDY_MODE_HINTS[mode];
    paintCounters();
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
  }

  for (const value of STUDY_MODES) {
    const button = el('button', { type: 'button', class: ui.button }, STUDY_MODE_LABELS[value]);
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
      scoreView.setLevel(level, currentInstrument());
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
    scoreView.reshuffle(maskSeed(), currentInstrument());
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
    body: el(
      'div',
      { class: 'flex flex-col gap-2' },
      el('div', { class: 'flex flex-wrap gap-2' }, ...modeButtons.values()),
      modeHint,
      maskRow,
      intensityRow,
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

  async function finish(): Promise<void> {
    player.pause();
    const instrument = currentInstrument();
    // Selon le mode, « indices » et « mesures dérobées » ne désignent pas la
    // même chose ; le rapport des deux, lui, garde le même sens : la part des
    // fois où l'on a eu besoin de la partition.
    const [used, total] =
      mode === 'eclipses'
        ? [eclipses.escapeCount, eclipses.count]
        : mode === 'sans'
          ? [0, scoreView.measureCount]
          : [hints, scoreView.maskedCount];
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
    if (context.session) context.session.onBlockEnd();
    else context.navigateHome();
  }

  const finishButton = el(
    'button',
    { type: 'button', class: ui.primary },
    context.session ? 'Terminer ce bloc' : 'Terminer et évaluer',
  );
  finishButton.addEventListener('click', () => void finish());

  const backButton = el('button', { type: 'button', class: ui.button }, 'Retour');
  backButton.addEventListener('click', () => context.navigateHome());

  // --- Minuteur de bloc (session entrelacée uniquement) -------------------

  const blockLabel = el('span', { class: 'font-mono text-amber-300' }, '');
  let timer: BlockTimer | null = null;
  if (context.session) {
    timer = new BlockTimer(
      (secondsLeft) => {
        blockLabel.textContent = formatCountdown(secondsLeft);
      },
      () => void finish(),
    );
    timer.start(context.session.blockMinutes);
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
        el(
          'p',
          {},
          `Session entrelacée — bloc ${context.session.blockIndex} sur ${context.session.blocks.length}`,
        ),
        el('p', {}, 'Temps restant : ', blockLabel),
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
    el('div', { class: 'flex flex-wrap gap-2' }, backButton, finishButton),
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
      scoreContainer,
    ),
    controlBar.root,
    eclipseVeil,
  );

  drawScore();
  paintMode();
  paintNoScore();
  if (mode === 'eclipses') eclipses.start();

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
    transport.destroy();
    controlBar.destroy();
    scoreView.destroy();
  };
}
