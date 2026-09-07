/** Filage : la setlist enchaînée comme en concert.
 *
 * Chaque morceau est joué avec sa bande (accompagnateur → enregistrement
 * original ; soliste Si♭/Mi♭ → playback). À la fin de l'audio, un décompte de
 * 5 secondes annonce le morceau suivant, puis la lecture reprend seule. La
 * partition de la transposition est affichée, masquable d'un bouton.
 */

import { el, ui } from '../dom';
import { ScoreView } from '../score';
import type { InstrumentId, Song } from '../types';
import { INSTRUMENT_SHORT_LABELS } from '../types';
import type { Player } from '../youtube';
import { formatTime, PLAYBACK_RATES } from '../youtube';

export interface FilageContext {
  player: Player;
  /** Morceaux dans l'ordre de la setlist (ordre de concert). */
  order: Song[];
  instrumentId: InstrumentId;
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

  let index = 0;
  let transitioning = false;
  let hasPlayed = false;
  let scrubbing = false;
  let countdownTimer: number | null = null;
  let showScore = true;
  let unsubscribe: (() => void) | null = null;

  /** Source audio du morceau : original pour l'accompagnateur, playback pour un soliste. */
  function audioId(song: Song): string | null {
    const wantReference = instrumentId === 'c';
    const primary = wantReference ? song.audio.reference : song.audio.playback;
    const fallback = wantReference ? song.audio.playback : song.audio.reference;
    return (primary ?? fallback)?.youtube_id ?? null;
  }

  // --- DOM ---------------------------------------------------------------

  const playerMount = el('div', { class: 'yt-audio-only' });

  const scoreContainer = el('div', { class: 'score-surface flex flex-col gap-6' });
  const scoreView = new ScoreView(scoreContainer, { onHintUsed: () => {} });
  const scoreNote = el('p', { class: `${ui.card} hidden text-sm text-zinc-400` });

  const positionLabel = el('p', { class: 'text-xs uppercase tracking-wider text-zinc-500' });
  const titleLabel = el('h1', { class: 'text-2xl font-semibold text-zinc-100' });
  const composerLabel = el('p', { class: 'text-sm text-zinc-400' });

  const timeLabel = el('span', { class: 'font-mono text-xs text-zinc-500' }, '0:00 / 0:00');
  const playButton = el('button', { type: 'button', class: ui.icon }, '▶');
  playButton.addEventListener('click', () => player.togglePlay());

  const nextButton = el('button', { type: 'button', class: ui.button }, 'Passer au suivant');
  nextButton.addEventListener('click', () => startCountdown());

  // --- Barre de lecture : on revient où l'on veut à tout moment ---------

  const seekFill = el('div', {
    class: 'absolute inset-y-0 left-0 rounded-full bg-amber-400',
  });
  const seekBarInner = el(
    'div',
    { class: 'relative h-1.5 w-full rounded-full bg-zinc-700' },
    seekFill,
  );
  const seekBar = el(
    'div',
    {
      class: 'flex h-11 w-full cursor-pointer items-center',
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
  const rateButtons = PLAYBACK_RATES.map((rate) => {
    const button = el(
      'button',
      { type: 'button', class: ui.button },
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
      button.className = PLAYBACK_RATES[i] === active ? ui.buttonActive : ui.button;
    });
  }
  paintRates(1);

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

  const countBig = el('div', { class: 'text-8xl font-bold tabular-nums text-amber-300' });
  const countNext = el('p', { class: 'max-w-sm text-center text-sm text-zinc-400' });
  const countdownVeil = el(
    'div',
    {
      class:
        'fixed inset-0 z-40 hidden flex-col items-center justify-center gap-4 ' +
        'bg-zinc-950/95 backdrop-blur-md',
    },
    el('p', { class: 'text-xs uppercase tracking-wider text-zinc-500' }, 'Morceau suivant'),
    countNext,
    countBig,
  );

  function paintScoreVisibility(): void {
    const hasScore = order[index]?.instruments.some((i) => i.id === instrumentId) ?? false;
    scoreContainer.classList.toggle('hidden', !showScore || !hasScore);
    scoreNote.classList.toggle('hidden', !(showScore && !hasScore));
  }

  // --- Déroulé ---------------------------------------------------------

  function loadSong(i: number, autoplay: boolean): void {
    index = i;
    const song = order[i]!;
    context.markReached(song.id);
    hasPlayed = false;
    seekFill.style.width = '0%';

    positionLabel.textContent = `Filage ${INSTRUMENT_SHORT_LABELS[instrumentId]} · ${context.setlistName} — ${i + 1} / ${order.length}`;
    titleLabel.textContent = song.title;
    composerLabel.textContent = song.composer || 'Compositeur inconnu';

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
      { class: 'mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 pb-16' },
      playerMount,
      el(
        'header',
        { class: 'flex flex-wrap items-start justify-between gap-4' },
        el('div', { class: 'min-w-0' }, positionLabel, titleLabel, composerLabel),
        el('div', { class: 'flex flex-wrap gap-2' }, backButton, finishButton),
      ),
      el(
        'div',
        { class: 'flex flex-col gap-3' },
        el(
          'div',
          { class: 'flex items-center gap-3' },
          playButton,
          seekBar,
          timeLabel,
        ),
        el(
          'div',
          { class: 'flex flex-wrap items-center gap-2' },
          el('span', { class: 'text-xs text-zinc-500' }, 'Vitesse'),
          ...rateButtons,
          el('span', { class: 'mx-1 h-5 w-px bg-zinc-700' }),
          nextButton,
          scoreToggle,
        ),
      ),
      scoreNote,
      scoreContainer,
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
