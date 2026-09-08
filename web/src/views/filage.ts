/** Filage : la setlist enchaînée comme en concert.
 *
 * Chaque morceau est joué avec sa bande (accompagnateur → enregistrement
 * original ; soliste Si♭/Mi♭ → playback). À la fin de l'audio, un décompte de
 * 5 secondes annonce le morceau suivant, puis la lecture reprend seule. La
 * partition de la transposition est affichée, masquable d'un bouton.
 */

import { el, ui } from '../dom';
import { ScoreView } from '../score';
import type { AudioKind, InstrumentId, Song } from '../types';
import { INSTRUMENT_SHORT_LABELS } from '../types';
import type { Player } from '../youtube';
import { formatTime, PLAYBACK_RATES } from '../youtube';

export interface FilageContext {
  player: Player;
  /** Morceaux dans l'ordre de la setlist (ordre de concert). */
  order: Song[];
  instrumentId: InstrumentId;
  /** Bande choisie à la préparation ; reste modifiable pendant le filage. */
  audioKind: AudioKind;
  setlistName: string;
  /** Marque un morceau comme atteint (pour le décompte de la séance). */
  markReached: (songId: string) => void;
  navigateHome: () => void;
  /** Termine le filage : enregistre la séance et montre le résumé. */
  onFinish: () => void;
}

const COUNTDOWN_S = 5;

export function renderFilage(root: HTMLElement, context: FilageContext): () => void {
  const { player, order, instrumentId } = context;

  let audioKind: AudioKind = context.audioKind;
  let index = 0;
  let transitioning = false;
  let hasPlayed = false;
  let scrubbing = false;
  let countdownTimer: number | null = null;
  let showScore = true;
  let unsubscribe: (() => void) | null = null;

  /** Source audio du morceau selon la bande choisie, avec repli sur l'autre. */
  function audioId(song: Song): string | null {
    const wantReference = audioKind === 'reference';
    const primary = wantReference ? song.audio.reference : song.audio.playback;
    const fallback = wantReference ? song.audio.playback : song.audio.reference;
    return (primary ?? fallback)?.youtube_id ?? null;
  }

  // --- DOM ---------------------------------------------------------------

  const playerMount = el('div', { class: 'yt-audio-only' });

  const scoreContainer = el('div', { class: 'score-surface flex flex-col gap-6' });
  const scoreView = new ScoreView(scoreContainer, { onHintUsed: () => {} });
  const scoreNote = el('p', { class: `${ui.card} hidden text-sm text-zinc-400` });

  // En-tête : contexte discret + sortie.
  const positionLabel = el('p', {
    class: 'text-xs font-semibold uppercase tracking-wider text-zinc-500',
  });

  // Scène (partition masquée) : le morceau en cours, en grand, et la suite.
  const stagePosition = el('p', { class: 'text-sm uppercase tracking-wider text-zinc-500' });
  const stageTitle = el('h1', {
    class: 'text-4xl font-semibold leading-tight text-zinc-100 sm:text-6xl lg:text-7xl',
  });
  const stageComposer = el('p', { class: 'text-lg text-zinc-400 sm:text-xl' });
  const upNextLabel = el('p', { class: `${ui.label}` }, 'À suivre');
  const upNextList = el('ol', { class: 'flex flex-col gap-2' });
  const stagePanel = el(
    'div',
    {
      class:
        'mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center ' +
        'gap-4 px-4 py-10 text-center',
    },
    stagePosition,
    stageTitle,
    stageComposer,
    el(
      'div',
      { class: 'mt-6 flex w-full max-w-sm flex-col gap-3 text-left' },
      upNextLabel,
      upNextList,
    ),
  );

  // Barre de titre au-dessus de la partition (partition affichée).
  const slimTitle = el('p', { class: 'text-lg font-medium text-zinc-200' });

  const timeLabel = el('span', {
    class: 'shrink-0 font-mono text-sm text-zinc-400 tabular-nums',
  }, '0:00 / 0:00');
  const playButton = el(
    'button',
    {
      type: 'button',
      class:
        'flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-amber-400 ' +
        'text-2xl text-zinc-950 shadow-lg shadow-amber-400/20 transition hover:bg-amber-300 ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ' +
        'focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
      'aria-label': 'Lecture ou pause',
    },
    '▶',
  );
  playButton.addEventListener('click', () => player.togglePlay());

  const nextButton = el('button', { type: 'button', class: ui.button }, '⏭  Passer au suivant');
  nextButton.addEventListener('click', () => startCountdown());

  // --- Barre de lecture : on revient où l'on veut à tout moment ---------

  const seekFill = el('div', {
    class: 'absolute inset-y-0 left-0 rounded-full bg-amber-400',
  });
  const seekBarInner = el(
    'div',
    { class: 'relative h-2.5 w-full rounded-full bg-zinc-700' },
    seekFill,
  );
  const seekBar = el(
    'div',
    {
      class: 'flex h-14 w-full flex-1 cursor-pointer items-center',
      role: 'slider',
      'aria-label': 'Position dans le morceau',
      'aria-valuemin': 0,
      'aria-valuenow': 0,
    },
    seekBarInner,
  );
  function seekFromEvent(event: PointerEvent): void {
    const rect = seekBarInner.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    seekFill.style.width = `${ratio * 100}%`;
    const duration = player.getDuration();
    if (duration > 0) player.seekTo(ratio * duration);
  }
  seekBar.addEventListener('pointerdown', (event) => {
    scrubbing = true;
    seekBar.setPointerCapture(event.pointerId);
    seekFromEvent(event);
  });
  seekBar.addEventListener('pointermove', (event) => {
    if (scrubbing) seekFromEvent(event);
  });
  const endScrub = (): void => {
    scrubbing = false;
  };
  seekBar.addEventListener('pointerup', endScrub);
  seekBar.addEventListener('pointercancel', endScrub);

  // --- Vitesse : disponible et modifiable à tout moment ----------------

  let chosenRate = 1;
  const rateClass = (on: boolean): string =>
    `min-h-11 min-w-[3.25rem] rounded-lg border px-3 text-sm font-medium transition ` +
    (on
      ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
      : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-700');
  const rateButtons = PLAYBACK_RATES.map((rate) => {
    const button = el(
      'button',
      { type: 'button', class: rateClass(rate === 1) },
      `${rate}×`.replace('.', ','),
    );
    button.addEventListener('click', () => {
      chosenRate = player.setRate(rate);
      paintRates(chosenRate);
    });
    return button;
  });
  function paintRates(active: number): void {
    rateButtons.forEach((button, i) => {
      button.className = rateClass(PLAYBACK_RATES[i] === active);
    });
  }

  // --- Bande : original ↔ playback, à tout moment ----------------------

  const audioClass = (on: boolean): string =>
    'min-h-11 rounded-lg border px-3 text-sm font-medium transition ' +
    (on
      ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
      : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-700');
  const audioOptions: { kind: AudioKind; label: string }[] = [
    { kind: 'reference', label: 'Original' },
    { kind: 'playback', label: 'Playback' },
  ];
  const audioButtons = audioOptions.map(({ kind, label }) => {
    const button = el('button', { type: 'button', class: audioClass(kind === audioKind) }, label);
    button.addEventListener('click', () => {
      if (kind === audioKind || transitioning) return;
      audioKind = kind;
      audioButtons.forEach((other, i) => {
        other.className = audioClass(audioOptions[i]!.kind === audioKind);
      });
      const id = audioId(order[index]!);
      if (id) player.load(id, player.getPlayerState() === 1);
    });
    return button;
  });

  const scoreToggle = el('button', { type: 'button', class: ui.button }, 'Masquer la partition');
  scoreToggle.addEventListener('click', () => {
    showScore = !showScore;
    scoreToggle.textContent = showScore ? 'Masquer la partition' : 'Afficher la partition';
    paintScoreVisibility();
  });

  const finishButton = el('button', { type: 'button', class: ui.primary }, 'Terminer le filage');
  finishButton.addEventListener('click', () => context.onFinish());

  const backButton = el('button', { type: 'button', class: ui.button }, 'Retour');
  backButton.addEventListener('click', () => context.navigateHome());

  const countBig = el('div', {
    class: 'text-[8rem] font-bold leading-none tabular-nums text-amber-300 sm:text-[12rem]',
  });
  const countNext = el('p', {
    class: 'max-w-md text-center text-2xl font-medium text-zinc-100 sm:text-4xl',
  });
  const countdownVeil = el(
    'div',
    {
      class:
        'fixed inset-0 z-40 hidden flex-col items-center justify-center gap-6 ' +
        'bg-zinc-950/95 px-6 backdrop-blur-md',
    },
    el('p', { class: 'text-sm uppercase tracking-wider text-zinc-500' }, 'Morceau suivant'),
    countNext,
    countBig,
  );

  function paintScoreVisibility(): void {
    const hasScore = order[index]?.instruments.some((i) => i.id === instrumentId) ?? false;
    const showingScore = showScore && hasScore;
    scoreContainer.classList.toggle('hidden', !showingScore);
    slimTitle.classList.toggle('hidden', !showingScore);
    stagePanel.classList.toggle('hidden', showingScore);
    scoreNote.classList.toggle('hidden', !(showScore && !hasScore));
    scoreToggle.textContent = showScore ? 'Masquer la partition' : 'Afficher la partition';
  }

  // --- Déroulé ---------------------------------------------------------

  function paintStage(): void {
    const composer = order[index]?.composer || 'Compositeur inconnu';
    stagePosition.textContent = `Morceau ${index + 1} sur ${order.length}`;
    stageTitle.textContent = order[index]?.title ?? '';
    stageComposer.textContent = composer;
    slimTitle.textContent = `${order[index]?.title ?? ''} · ${composer}`;

    const upcoming = order.slice(index + 1, index + 4);
    upNextLabel.classList.toggle('hidden', upcoming.length === 0);
    upNextList.replaceChildren(
      ...(upcoming.length === 0
        ? [el('li', { class: 'text-sm text-zinc-600' }, 'Dernier morceau du filage.')]
        : upcoming.map((song, k) =>
            el(
              'li',
              { class: 'flex items-baseline gap-3' },
              el('span', { class: 'w-5 shrink-0 font-mono text-sm text-zinc-600' }, String(index + 2 + k)),
              el('span', { class: 'text-lg text-zinc-300' }, song.title),
            ),
          )),
    );
  }

  function loadSong(i: number, autoplay: boolean): void {
    index = i;
    const song = order[i]!;
    context.markReached(song.id);
    hasPlayed = false;
    seekFill.style.width = '0%';

    positionLabel.textContent =
      `Filage ${INSTRUMENT_SHORT_LABELS[instrumentId]} · ${context.setlistName} · ${i + 1} / ${order.length}`;
    paintStage();

    const instrument = song.instruments.find((entry) => entry.id === instrumentId);
    if (instrument) {
      scoreView.render(instrument, `${song.id}::${instrumentId}`, 0);
    } else {
      scoreView.destroy();
      scoreNote.textContent = `Pas de partition en ${INSTRUMENT_SHORT_LABELS[instrumentId]} pour ce morceau.`;
    }
    paintScoreVisibility();

    const id = audioId(song);
    if (id) player.load(id, autoplay);
  }

  function startCountdown(): void {
    if (transitioning) return;
    transitioning = true;
    player.pause();

    const next = order[index + 1];
    if (!next) {
      transitioning = false;
      context.onFinish();
      return;
    }

    countNext.textContent = next.title;
    countdownVeil.classList.remove('hidden');
    countdownVeil.classList.add('flex');

    let remaining = COUNTDOWN_S;
    countBig.textContent = String(remaining);
    countdownTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        countBig.textContent = String(remaining);
        return;
      }
      if (countdownTimer !== null) window.clearInterval(countdownTimer);
      countdownTimer = null;
      countdownVeil.classList.add('hidden');
      countdownVeil.classList.remove('flex');
      transitioning = false;
      loadSong(index + 1, true);
    }, 1000);
  }

  // --- Assemblage ----------------------------------------------------

  root.replaceChildren(
    el(
      'div',
      { class: 'flex min-h-dvh flex-col' },
      playerMount,

      el(
        'header',
        {
          class:
            'flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6',
        },
        positionLabel,
        el('div', { class: 'flex flex-wrap gap-2' }, backButton, finishButton),
      ),

      // Zone principale : la scène, ou la partition.
      el(
        'main',
        { class: 'flex flex-1 flex-col overflow-y-auto px-4 pb-4 sm:px-6' },
        stagePanel,
        el(
          'div',
          { class: 'mx-auto flex w-full max-w-5xl flex-col gap-4' },
          slimTitle,
          scoreNote,
          scoreContainer,
        ),
      ),

      // Dock de contrôle, toujours visible en bas.
      el(
        'div',
        {
          class:
            'sticky bottom-0 border-t border-zinc-800 bg-zinc-950/95 px-4 py-4 backdrop-blur ' +
            'pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-6',
        },
        el(
          'div',
          { class: 'mx-auto flex w-full max-w-4xl flex-col gap-4' },
          el(
            'div',
            { class: 'flex items-center gap-4' },
            playButton,
            seekBar,
            timeLabel,
          ),
          el(
            'div',
            { class: 'flex flex-wrap items-center gap-2' },
            el('span', { class: 'text-xs uppercase tracking-wider text-zinc-500' }, 'Vitesse'),
            ...rateButtons,
            el('span', { class: 'mx-1 hidden h-6 w-px bg-zinc-700 sm:block' }),
            el('span', { class: 'text-xs uppercase tracking-wider text-zinc-500' }, 'Bande'),
            ...audioButtons,
            el('span', { class: 'mx-1 hidden h-6 w-px bg-zinc-700 sm:block' }),
            nextButton,
            scoreToggle,
          ),
        ),
      ),
    ),
    countdownVeil,
  );

  // Les libellés et la partition du 1er morceau s'affichent tout de suite ;
  // seul l'audio attend le montage du lecteur.
  loadSong(0, true);

  unsubscribe = player.onTick((tick) => {
    playButton.textContent = tick.playing ? '❚❚' : '▶';
    timeLabel.textContent = `${formatTime(tick.currentTime)} / ${formatTime(tick.duration)}`;
    if (tick.playing) {
      hasPlayed = true;
      // YouTube peut réinitialiser la vitesse au chargement d'un morceau.
      if (chosenRate !== 1 && Math.abs(player.getRate() - chosenRate) > 0.01) {
        player.setRate(chosenRate);
      }
    }
    if (!scrubbing && tick.duration > 0) {
      seekFill.style.width = `${(tick.currentTime / tick.duration) * 100}%`;
      seekBar.setAttribute('aria-valuenow', String(Math.round(tick.currentTime)));
      seekBar.setAttribute('aria-valuemax', String(Math.round(tick.duration)));
    }

    const ended =
      hasPlayed &&
      !transitioning &&
      !scrubbing &&
      !tick.playing &&
      (player.getPlayerState() === 0 ||
        (tick.duration > 0 && tick.currentTime >= tick.duration - 0.4));
    if (ended) startCountdown();
  });

  void (async () => {
    try {
      await player.mount(playerMount);
      // Relance la source du morceau courant maintenant que le lecteur est prêt.
      const id = audioId(order[index]!);
      if (id) player.load(id, true);
    } catch {
      scoreNote.textContent = 'Lecteur indisponible (connexion ou blocage réseau) — enchaînez à la main.';
      scoreNote.classList.remove('hidden');
    }
  })();

  return () => {
    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    unsubscribe?.();
    player.pause();
    player.clearCountdown();
    scoreView.destroy();
    countdownVeil.remove();
  };
}
