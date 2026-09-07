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
import { formatTime } from '../youtube';

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
        { class: 'flex flex-wrap items-center gap-3' },
        playButton,
        timeLabel,
        nextButton,
        scoreToggle,
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
    if (tick.playing) hasPlayed = true;

    const ended =
      hasPlayed &&
      !transitioning &&
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
