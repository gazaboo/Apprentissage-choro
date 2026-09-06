/** Écran d'entraînement : partition à trous, et barre de transport fixe.
 *
 * La partition occupe tout l'espace et défile librement ; le pilotage vit dans
 * une barre qui ne disparaît jamais. Tout est atteignable au doigt : il n'y a
 * aucun raccourci clavier, et aucune action n'est cachée.
 */

import { el, ui } from '../dom';
import { ScoreView } from '../score';
import { BlockTimer, formatCountdown } from '../session';
import type { SessionBlock } from '../session';
import { createControlBar } from '../sheet';
import { review, statusOf, STATUS_LABELS } from '../srs';
import type { Progress } from '../store';
import { getCard, putCard, saveProgress } from '../store';
import { createTransport } from '../transport';
import type { Section } from '../transport';
import type { InstrumentId, MaskLevel, Song } from '../types';
import { MASK_LEVEL_LABELS, MASK_LEVELS } from '../types';
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

  const countersLabel = el('p', { class: 'text-xs text-zinc-500' });
  function paintCounters(): void {
    const masked = scoreView.maskedCount;
    countersLabel.textContent =
      `${masked} mesure${masked > 1 ? 's' : ''} dérobée${masked > 1 ? 's' : ''} · ` +
      `${hints} indice${hints > 1 ? 's' : ''}`;
  }

  function drawScore(): void {
    scoreView.render(currentInstrument(), maskSeed(), maskLevel);
    scoreView.resetHintCursor();
    paintCounters();
  }

  // --- Masquage -----------------------------------------------------------

  const maskButtons = new Map<string, HTMLButtonElement>();
  function paintMask(): void {
    for (const [key, button] of maskButtons) {
      button.className = key === String(maskLevel) ? ui.buttonActive : ui.button;
    }
  }
  for (const level of MASK_LEVELS) {
    const button = el(
      'button',
      { type: 'button', class: ui.button },
      MASK_LEVEL_LABELS[String(level)]!,
    );
    button.addEventListener('click', () => {
      if (level === maskLevel) return;
      maskLevel = level;
      progress.settings.maskLevel = level;
      saveProgress(progress);
      paintMask();
      scoreView.setLevel(level, currentInstrument());
      paintCounters();
    });
    maskButtons.set(String(level), button);
  }
  paintMask();

  const shuffleButton = el(
    'button',
    { type: 'button', class: ui.button, title: 'Nouveau tirage des mesures masquées' },
    '🎲 Mélanger',
  );
  shuffleButton.addEventListener('click', () => {
    progress.settings.maskSeed += 1;
    saveProgress(progress);
    scoreView.reshuffle(maskSeed(), currentInstrument());
    paintCounters();
  });

  const hintButton = el(
    'button',
    { type: 'button', class: ui.button, title: 'Révèle la mesure masquée suivante' },
    '💡 Indice',
  );
  hintButton.addEventListener('click', () => scoreView.revealNext());

  const maskSection: Section = {
    title: 'Cacher des mesures',
    hint: 'Des mesures sont recouvertes : à vous de les retrouver de mémoire. ' +
      'Touchez-en une pour la revoir 5 secondes.',
    body: el(
      'div',
      { class: 'flex flex-col gap-2' },
      el('div', { class: 'flex flex-wrap gap-2' }, ...maskButtons.values()),
      el('div', { class: 'flex flex-wrap gap-2' }, shuffleButton, hintButton),
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
    sections: [...transport.sections, maskSection],
  });

  // --- Évaluation ---------------------------------------------------------

  async function finish(): Promise<void> {
    player.pause();
    const instrument = currentInstrument();
    const answer = await askSrs(song.title, instrument.name, hints, scoreView.maskedCount);
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
      'Choisissez un autre palier de masquage pour la faire réapparaître.',
  );
  function paintNoScore(): void {
    noScore.classList.toggle('hidden', maskLevel !== 'aucune');
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
  );

  drawScore();
  paintNoScore();
  for (const [, button] of maskButtons) {
    button.addEventListener('click', paintNoScore);
  }

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
    player.clearCountdown();
    transport.destroy();
    controlBar.destroy();
    scoreView.destroy();
  };
}
