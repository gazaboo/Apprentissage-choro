/** Écran d'entraînement : lecteur, sélecteurs, partition à trous.
 *
 * C'est ici que se combinent les leviers cognitifs : source audio, ghost mode,
 * saut à froid, niveau de masquage et indices éphémères — le tout pilotable au
 * clavier, sans lâcher l'instrument.
 */

import { el, ui } from '../dom';
import { setShortcuts } from '../keyboard';
import { ScoreView } from '../score';
import { BlockTimer, formatCountdown } from '../session';
import type { SessionBlock } from '../session';
import { review, statusOf, STATUS_LABELS } from '../srs';
import type { Progress } from '../store';
import { getCard, putCard, saveProgress } from '../store';
import type { AudioKind, InstrumentId, MaskLevel, Song } from '../types';
import { PLAYBACK_RATES, Player } from '../youtube';
import { askSrs } from './srsModal';

const MASK_LEVELS: MaskLevel[] = [25, 50, 80];
/** Couleur des masques : identique au fond, pour un trou franc. */
const MASK_COLOR = '#09090b'; // zinc-950

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
  let source: AudioKind = song.audio.reference ? 'reference' : 'playback';
  let ghost = false;
  let hints = 0;
  let maskLevel = (MASK_LEVELS.includes(progress.settings.maskLevel as MaskLevel)
    ? progress.settings.maskLevel
    : 50) as MaskLevel;

  const hasSource = (kind: AudioKind): boolean => song.audio[kind] !== null;
  const anySource = hasSource('reference') || hasSource('playback');
  if (!hasSource(source) && anySource) {
    source = source === 'reference' ? 'playback' : 'reference';
  }

  // --- Squelette ----------------------------------------------------------
  const scoreContainer = el('div', { class: 'flex flex-col gap-6' });
  const scoreView = new ScoreView(scoreContainer, {
    maskColor: MASK_COLOR,
    onHintUsed: () => {
      hints += 1;
      hintCounter.textContent = String(hints);
    },
  });

  const playerMount = el('div', { class: 'h-full w-full' });
  const ghostVeil = el('div', {
    class:
      'pointer-events-none absolute inset-0 hidden items-center justify-center ' +
      'bg-zinc-950 text-sm text-zinc-600',
  });
  ghostVeil.textContent = 'Ghost mode — audio seul';

  const countdownVeil = el('div', {
    class:
      'pointer-events-none absolute inset-0 hidden items-center justify-center ' +
      'bg-zinc-950/95 text-7xl font-bold text-amber-300',
  });

  const playerFrame = el(
    'div',
    {
      class:
        'relative aspect-video w-full overflow-hidden rounded-xl border ' +
        'border-zinc-800 bg-black',
    },
    playerMount,
    ghostVeil,
    countdownVeil,
  );

  const hintCounter = el('span', { class: 'font-mono text-zinc-300' }, '0');
  const rateLabel = el('span', { class: 'font-mono text-zinc-300' }, '1×');
  const blockLabel = el('span', { class: 'font-mono text-amber-300' }, '');

  // --- Sélecteurs ---------------------------------------------------------
  const sourceButtons = new Map<AudioKind, HTMLButtonElement>();
  const instrumentButtons = new Map<InstrumentId, HTMLButtonElement>();
  const maskButtons = new Map<MaskLevel, HTMLButtonElement>();

  function paintSelectors(): void {
    for (const [kind, button] of sourceButtons) {
      button.className = kind === source ? ui.buttonActive : ui.button;
    }
    for (const [id, button] of instrumentButtons) {
      button.className = id === instrumentId ? ui.buttonActive : ui.button;
    }
    for (const [level, button] of maskButtons) {
      button.className = level === maskLevel ? ui.buttonActive : ui.button;
    }
  }

  function loadSource(): void {
    const audio = song.audio[source];
    if (audio) player.cue(audio.youtube_id);
  }

  function setSource(kind: AudioKind): void {
    if (!hasSource(kind) || kind === source) return;
    source = kind;
    paintSelectors();
    loadSource();
  }

  function toggleSource(): void {
    setSource(source === 'reference' ? 'playback' : 'reference');
  }

  /** Change de partition sans toucher au lecteur : l'audio n'est pas coupé. */
  function setInstrument(id: InstrumentId): void {
    if (id === instrumentId) return;
    instrumentId = id;
    hints = 0;
    hintCounter.textContent = '0';
    paintSelectors();
    drawScore();
  }

  function nextInstrument(): void {
    const index = song.instruments.findIndex((i) => i.id === instrumentId);
    const next = song.instruments[(index + 1) % song.instruments.length]!;
    setInstrument(next.id);
  }

  function setMaskLevel(level: MaskLevel): void {
    maskLevel = level;
    progress.settings.maskLevel = level;
    saveProgress(progress);
    paintSelectors();
    scoreView.setLevel(level);
    maskedLabel.textContent = String(scoreView.maskedCount);
  }

  function drawScore(): void {
    const instrument = song.instruments.find((i) => i.id === instrumentId)!;
    scoreView.render(instrument, `${song.id}::${instrument.id}`, maskLevel);
    maskedLabel.textContent = String(scoreView.maskedCount);
  }

  const maskedLabel = el('span', { class: 'font-mono text-zinc-300' }, '0');

  for (const kind of ['reference', 'playback'] as AudioKind[]) {
    const available = hasSource(kind);
    const label = kind === 'reference' ? 'Référence' : 'Playback';
    const button = el(
      'button',
      {
        type: 'button',
        class: ui.button,
        disabled: !available,
        title: available ? undefined : 'Aucune URL fournie pour ce morceau',
      },
      available ? label : `${label} (Non disponible)`,
    );
    button.addEventListener('click', () => setSource(kind));
    sourceButtons.set(kind, button);
  }

  for (const instrument of song.instruments) {
    const button = el('button', { type: 'button', class: ui.button }, instrument.name);
    button.addEventListener('click', () => setInstrument(instrument.id));
    instrumentButtons.set(instrument.id, button);
  }

  for (const level of MASK_LEVELS) {
    const button = el('button', { type: 'button', class: ui.button }, `${level} %`);
    button.addEventListener('click', () => setMaskLevel(level));
    maskButtons.set(level, button);
  }

  // --- Contrôles cognitifs ------------------------------------------------
  function setGhost(next: boolean): void {
    ghost = next;
    ghostVeil.classList.toggle('hidden', !ghost);
    ghostVeil.classList.toggle('flex', ghost);
    ghostButton.className = ghost ? ui.buttonActive : ui.button;
  }

  const ghostButton = el('button', { type: 'button', class: ui.button }, 'Ghost mode');
  ghostButton.addEventListener('click', () => setGhost(!ghost));

  function coldJump(): void {
    if (!anySource) return;
    countdownVeil.classList.remove('hidden');
    countdownVeil.classList.add('flex');
    player.coldJump((remaining) => {
      countdownVeil.textContent = remaining > 0 ? String(remaining) : 'Jouez !';
      if (remaining === 0) {
        window.setTimeout(() => {
          countdownVeil.classList.add('hidden');
          countdownVeil.classList.remove('flex');
        }, 400);
      }
    });
  }

  const jumpButton = el(
    'button',
    { type: 'button', class: ui.button, disabled: !anySource },
    'Saut à froid',
  );
  jumpButton.addEventListener('click', coldJump);

  const rateButtons = PLAYBACK_RATES.map((rate) => {
    const button = el('button', { type: 'button', class: ui.button }, `${rate}×`);
    button.addEventListener('click', () => {
      const effective = player.setRate(rate);
      rateLabel.textContent = `${effective}×`;
      rateButtons.forEach((other, index) => {
        other.className = PLAYBACK_RATES[index] === effective ? ui.buttonActive : ui.button;
      });
    });
    return button;
  });

  // --- Évaluation ---------------------------------------------------------
  async function finish(): Promise<void> {
    player.pause();
    const instrument = song.instruments.find((i) => i.id === instrumentId)!;
    const answer = await askSrs(
      song.title,
      instrument.name,
      hints,
      scoreView.maskedCount,
    );
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
    hintCounter.textContent = '0';
    installShortcuts();
    if (context.session) context.session.onBlockEnd();
    else context.navigateHome();
  }

  const finishButton = el(
    'button',
    { type: 'button', class: ui.primary },
    context.session ? 'Terminer ce bloc' : 'Terminer et évaluer',
  );
  finishButton.addEventListener('click', () => void finish());

  // --- Minuteur de bloc (session entrelacée uniquement) -------------------
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
  const card = getCard(progress, song.id, instrumentId);
  const status = statusOf(card);

  const sessionBanner = context.session
    ? el(
        'div',
        {
          class:
            'flex items-center justify-between gap-4 rounded-xl border ' +
            'border-amber-400/30 bg-amber-400/10 px-4 py-3',
        },
        el(
          'p',
          { class: 'text-sm text-amber-200' },
          `Session entrelacée — bloc ${context.session.blockIndex} sur ${context.session.blocks.length}`,
        ),
        el(
          'p',
          { class: 'text-sm text-amber-200' },
          'Temps restant : ',
          blockLabel,
        ),
      )
    : null;

  const header = el(
    'header',
    { class: 'flex flex-wrap items-start justify-between gap-4' },
    el(
      'div',
      {},
      el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, song.title),
      el(
        'p',
        { class: 'text-sm text-zinc-500' },
        song.composer || 'Compositeur inconnu',
        ' · ',
        STATUS_LABELS[status],
      ),
    ),
    el('div', { class: 'flex gap-2' }, backButton(context), finishButton),
  );

  const controls = el(
    'div',
    { class: 'grid gap-4 lg:grid-cols-2' },
    el(
      'div',
      { class: ui.card },
      el('p', { class: ui.label }, 'Source audio'),
      el(
        'div',
        { class: 'mt-2 flex flex-wrap gap-2' },
        ...sourceButtons.values(),
      ),
      el('p', { class: `${ui.label} mt-4` }, 'Vitesse de lecture'),
      el('div', { class: 'mt-2 flex flex-wrap gap-2' }, ...rateButtons),
      el('p', { class: `${ui.label} mt-4` }, 'Contrôles cognitifs'),
      el('div', { class: 'mt-2 flex flex-wrap gap-2' }, jumpButton, ghostButton),
    ),
    el(
      'div',
      { class: ui.card },
      // Un seul instrument disponible : le sélecteur n'a rien à proposer.
      song.instruments.length > 1
        ? el('p', { class: ui.label }, 'Transposition')
        : null,
      song.instruments.length > 1
        ? el('div', { class: 'mt-2 flex flex-wrap gap-2' }, ...instrumentButtons.values())
        : el(
            'p',
            { class: 'text-sm text-zinc-500' },
            `Partition unique : ${song.instruments[0]!.name}`,
          ),
      el('p', { class: `${ui.label} mt-4` }, 'Masquage de la partition'),
      el('div', { class: 'mt-2 flex flex-wrap gap-2' }, ...maskButtons.values()),
      el(
        'dl',
        { class: 'mt-4 flex gap-6 text-sm text-zinc-500' },
        el('div', {}, el('dt', { class: 'text-xs' }, 'Mesures masquées'), el('dd', {}, maskedLabel)),
        el('div', {}, el('dt', { class: 'text-xs' }, 'Indices utilisés'), el('dd', {}, hintCounter)),
        el('div', {}, el('dt', { class: 'text-xs' }, 'Vitesse'), el('dd', {}, rateLabel)),
      ),
    ),
  );

  const noAudio = !anySource
    ? el(
        'p',
        {
          class:
            'rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-400',
        },
        'Aucune vidéo disponible pour ce morceau — l’entraînement sur partition reste utilisable.',
      )
    : null;

  root.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6' },
      sessionBanner,
      header,
      anySource ? playerFrame : noAudio,
      controls,
      scoreContainer,
    ),
  );

  // Le lecteur ne peut être monté qu'une fois son conteneur dans le document.
  if (anySource) {
    void (async () => {
      try {
        await player.mount(playerMount);
        loadSource();
      } catch {
        playerMount.replaceChildren(
          el(
            'p',
            { class: 'flex h-full items-center justify-center p-4 text-sm text-zinc-500' },
            'Lecteur YouTube indisponible (connexion ou blocage réseau).',
          ),
        );
      }
    })();
  }

  paintSelectors();
  drawScore();

  function installShortcuts(): void {
    setShortcuts({
      playPause: () => player.togglePlay(),
      toggleSource: toggleSource,
      hint: () => scoreView.revealNext(),
      randomJump: coldJump,
      ghostMode: () => setGhost(!ghost),
      nextInstrument: nextInstrument,
      escape: () => context.navigateHome(),
    });
  }
  installShortcuts();

  // Fonction de démontage, appelée par le routeur au changement d'écran.
  return () => {
    timer?.stop();
    player.clearCountdown();
    scoreView.destroy();
    setShortcuts({});
  };
}

function backButton(context: TrainerContext): HTMLButtonElement {
  const button = el('button', { type: 'button', class: ui.button }, 'Retour');
  button.addEventListener('click', () => context.navigateHome());
  return button;
}
