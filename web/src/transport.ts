/** Barre de transport : tout le pilotage du lecteur, en boutons visibles.
 *
 * L'application s'adresse à des musiciens, pas à des utilisateurs de clavier :
 * il n'y a aucun raccourci, et toute action doit se voir et s'atteindre au
 * doigt. La barre expose donc explicitement ce qui était autrefois caché
 * derrière des touches — source, vitesse, transposition, saut à froid, ghost
 * mode — auxquels s'ajoute la boucle A-B.
 *
 * Elle produit deux groupes de nœuds : `primary` (lecture, défilement,
 * vitesse), toujours visible, et `sections` (le reste), que la vue place dans
 * le dock sur grand écran ou dans un panneau escamotable sur petit écran.
 */

import { el, ui } from './dom';
import type { Player } from './youtube';
import { formatTime, PLAYBACK_RATES } from './youtube';
import type { AudioKind, InstrumentId, Song } from './types';

/** Bloc de réglages secondaires, avec son intitulé. */
export interface Section {
  title: string;
  /** Une phrase disant à quoi sert le réglage — le titre seul ne suffit pas. */
  hint?: string;
  body: HTMLElement;
}

export interface TransportOptions {
  song: Song;
  player: Player;
  /** Appelé quand l'utilisateur change de transposition. */
  onInstrument: (id: InstrumentId) => void;
}

export interface Transport {
  primary: HTMLElement;
  sections: Section[];
  /** Charge la source courante dans le lecteur (après le montage). */
  loadSource: () => void;
  destroy: () => void;
}

/** Pas d'ajustement d'une borne de boucle : au tap, puis à l'appui long. */
const NUDGE_TAP = 0.5;
const NUDGE_HOLD = 2;
const HOLD_DELAY_MS = 500;
const HOLD_REPEAT_MS = 250;

export function createTransport(options: TransportOptions): Transport {
  const { song, player } = options;

  let source: AudioKind = song.audio.reference ? 'reference' : 'playback';
  let instrumentId: InstrumentId = song.instruments[0]!.id;
  let ghost = false;
  let scrubbing = false;
  let duration = 0;

  const hasSource = (kind: AudioKind): boolean => song.audio[kind] !== null;
  const anySource = hasSource('reference') || hasSource('playback');
  if (!hasSource(source) && anySource) source = 'playback';

  const disposers: Array<() => void> = [];

  // --- Lecture ------------------------------------------------------------

  const playIcon = el('span', { class: 'text-2xl leading-none' }, '▶');
  const playButton = el(
    'button',
    {
      type: 'button',
      class:
        'inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full ' +
        'bg-amber-400 pl-1 text-zinc-950 shadow-lg shadow-amber-400/20 ' +
        'transition hover:bg-amber-300 focus:outline-none focus-visible:ring-2 ' +
        'focus-visible:ring-amber-400 focus-visible:ring-offset-2 ' +
        'focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed ' +
        'disabled:opacity-40',
      'aria-label': 'Lecture ou pause',
      disabled: !anySource,
    },
    playIcon,
  );
  playButton.addEventListener('click', () => player.togglePlay());

  // --- Défilement ---------------------------------------------------------

  const progress = el('div', {
    class: 'absolute inset-y-0 left-0 rounded-full bg-amber-400',
  });
  // Hors boucle, la piste est assombrie : le passage travaillé est le seul
  // endroit éclairé, ce qui rend le bouclage lisible d'un coup d'œil.
  const scrimBefore = el('div', {
    class: 'absolute inset-y-0 left-0 hidden rounded-l-full bg-zinc-950/55',
  });
  const scrimAfter = el('div', {
    class: 'absolute inset-y-0 right-0 hidden rounded-r-full bg-zinc-950/55',
  });
  const loopBand = el('div', {
    class: 'loop-band absolute inset-y-0 hidden bg-amber-400/30',
  });
  const loopTick = () =>
    el('div', {
      class: 'absolute -inset-y-1.5 hidden w-0.5 -translate-x-1/2 rounded-full bg-amber-200',
    });
  const tickA = loopTick();
  const tickB = loopTick();
  const track = el(
    'div',
    { class: 'seek-track relative w-full rounded-full bg-zinc-700' },
    loopBand,
    progress,
    scrimBefore,
    scrimAfter,
    tickA,
    tickB,
  );
  const currentLabel = el('span', { class: 'font-mono text-xs text-zinc-400' }, '0:00');
  const durationLabel = el('span', { class: 'font-mono text-xs text-zinc-500' }, '0:00');

  const seekBar = el(
    'div',
    {
      // La zone cliquable fait 44 px de haut, même si la piste n'en fait que 4.
      class: 'seek-bar flex h-11 w-full cursor-pointer items-center',
      role: 'slider',
      'aria-label': 'Position dans le morceau',
      'aria-valuemin': 0,
      'aria-valuenow': 0,
    },
    track,
  );

  function ratioFromEvent(event: PointerEvent): number {
    const rect = track.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  }

  function paintProgress(ratio: number, current: number): void {
    progress.style.width = `${ratio * 100}%`;
    currentLabel.textContent = formatTime(current);
    seekBar.setAttribute('aria-valuenow', String(Math.round(current)));
    seekBar.setAttribute('aria-valuetext', formatTime(current));
  }

  seekBar.addEventListener('pointerdown', (event) => {
    if (!duration) return;
    scrubbing = true;
    seekBar.classList.add('is-dragging');
    seekBar.setPointerCapture(event.pointerId);
    const ratio = ratioFromEvent(event);
    paintProgress(ratio, ratio * duration);
  });
  seekBar.addEventListener('pointermove', (event) => {
    if (!scrubbing || !duration) return;
    const ratio = ratioFromEvent(event);
    paintProgress(ratio, ratio * duration);
  });
  const endScrub = (event: PointerEvent): void => {
    if (!scrubbing) return;
    scrubbing = false;
    seekBar.classList.remove('is-dragging');
    if (duration) player.seekTo(ratioFromEvent(event) * duration);
  };
  seekBar.addEventListener('pointerup', endScrub);
  seekBar.addEventListener('pointercancel', endScrub);

  /** Résumé de la boucle en cours, affiché entre position et durée. */
  const loopBadge = el('span', {
    class:
      'hidden min-w-0 shrink truncate rounded px-1.5 text-[11px] font-medium ' +
      'text-amber-300',
    title: 'Le passage encadré tourne en boucle',
  });

  const seekRow = el(
    'div',
    { class: 'flex min-w-0 flex-1 flex-col gap-0.5' },
    seekBar,
    el(
      'div',
      { class: 'flex items-center justify-between gap-2' },
      currentLabel,
      loopBadge,
      durationLabel,
    ),
  );

  // --- Vitesse ------------------------------------------------------------

  const rateButtons = new Map<number, HTMLButtonElement>();
  function paintRates(effective: number): void {
    for (const [rate, button] of rateButtons) {
      button.className = rate === effective ? ui.iconActive : ui.icon;
    }
  }
  for (const rate of PLAYBACK_RATES) {
    const button = el(
      'button',
      { type: 'button', class: ui.icon, 'aria-label': `Vitesse ${rate} fois` },
      el('span', { class: 'text-xs font-semibold' }, `${rate}×`),
    );
    button.addEventListener('click', () => paintRates(player.setRate(rate)));
    rateButtons.set(rate, button);
  }
  const rateGroup = el(
    'div',
    { class: 'flex shrink-0 gap-1', role: 'group', 'aria-label': 'Vitesse de lecture' },
    ...rateButtons.values(),
  );
  paintRates(1);

  const primary = el(
    'div',
    { class: 'flex w-full items-center gap-3' },
    playButton,
    seekRow,
    rateGroup,
  );

  // --- Source audio -------------------------------------------------------

  const sourceButtons = new Map<AudioKind, HTMLButtonElement>();
  function paintSource(): void {
    for (const [kind, button] of sourceButtons) {
      if (button.disabled) continue;
      button.className =
        `${kind === source ? ui.buttonActive : ui.button} flex-1 lg:flex-none`;
    }
  }
  function loadSource(): void {
    const audio = song.audio[source];
    if (audio) player.cue(audio.youtube_id);
    player.clearLoop();
    paintLoop();
  }
  for (const kind of ['reference', 'playback'] as AudioKind[]) {
    const available = hasSource(kind);
    const label = kind === 'reference' ? '🎧 Original' : '🎸 Playback';
    const button = el(
      'button',
      {
        type: 'button',
        class: `${ui.button} flex-1 lg:flex-none`,
        disabled: !available,
        title: available ? undefined : 'Aucune URL fournie pour ce morceau',
      },
      available ? label : `${label} — non disponible`,
    );
    button.addEventListener('click', () => {
      if (kind === source) return;
      source = kind;
      paintSource();
      loadSource();
    });
    sourceButtons.set(kind, button);
  }
  paintSource();

  // --- Transposition ------------------------------------------------------

  /** Libellés courts : le nom complet du manifeste passe à la ligne. */
  const INSTRUMENT_SHORT: Record<InstrumentId, string> = {
    c: 'Ut (C)',
    bb: 'Si♭ (B♭)',
    eb: 'Mi♭ (E♭)',
  };

  const instrumentButtons = new Map<InstrumentId, HTMLButtonElement>();
  for (const instrument of song.instruments) {
    const button = el(
      'button',
      { type: 'button', class: `${ui.button} flex-1 lg:flex-none`, title: instrument.name },
      INSTRUMENT_SHORT[instrument.id] ?? instrument.name,
    );
    button.addEventListener('click', () => {
      if (instrument.id === instrumentId) return;
      instrumentId = instrument.id;
      for (const [id, other] of instrumentButtons) {
        other.className =
          `${id === instrumentId ? ui.buttonActive : ui.button} flex-1 lg:flex-none`;
      }
      options.onInstrument(instrument.id);
    });
    instrumentButtons.set(instrument.id, button);
  }
  instrumentButtons.get(instrumentId)!.className = `${ui.buttonActive} flex-1 lg:flex-none`;

  // --- Répétition d'un passage --------------------------------------------
  //
  // « A » et « B » nomment le mécanisme, pas l'intention : personne ne cherche
  // une boucle A-B, on cherche à faire tourner un passage. Tout est donc
  // libellé « début » et « fin », et le geste principal — tracer le passage
  // sur la frise — s'annonce lui-même dans la frise vide.

  const aLabel = el('span', { class: 'font-mono text-xs text-zinc-300' }, '—');
  const bLabel = el('span', { class: 'font-mono text-xs text-zinc-300' }, '—');
  const loopHint = el('p', { class: 'text-[11px] leading-snug text-zinc-500' }, '');

  /** Dernier état peint, pour ne pas réécrire le DOM à chaque battement. */
  let paintedLoop = '';
  /** Boucle en cours de tracé à la souris ; prime sur celle du lecteur. */
  let draftLoop: { a: number; b: number } | null = null;
  let laps = 0;

  /** Boucle à afficher : le brouillon pendant un glissement, sinon la vraie. */
  function shownLoop(): { a: number | null; b: number | null } {
    return draftLoop ?? player.getLoop();
  }

  function paintLoop(): void {
    const loop = shownLoop();
    const active = loop.a !== null && loop.b !== null;
    const signature = `${loop.a}|${loop.b}|${duration}|${laps}|${!!draftLoop}`;
    if (signature === paintedLoop) return;
    paintedLoop = signature;

    aLabel.textContent = loop.a === null ? '—' : formatTime(loop.a);
    bLabel.textContent = loop.b === null ? '—' : formatTime(loop.b);

    const marking = loop.a !== null && loop.b === null;
    lanePrompt.classList.toggle('hidden', active || !!draftLoop);
    laneRail.classList.toggle('border-dashed', !active);
    loopBounds.classList.toggle('hidden', !active);

    markButton.className = active ? ui.button : ui.buttonActive;
    markButton.textContent = active
      ? '\u2715 Arrêter de répéter'
      : marking
        ? '\u23F9 Le passage finit ici'
        : '\u23FA Le passage commence ici';

    loopHint.textContent = active
      ? 'Ce passage tourne en boucle. Glissez ses bords sur la frise, ou ' +
        'réglez-les finement avec \u25C0\uFE0E \u25B6\uFE0E (appui long : 2 s).'
      : marking
        ? `Début posé à ${formatTime(loop.a!)}. Laissez jouer jusqu’au bout du ` +
          'passage, puis appuyez de nouveau.'
        : 'Deux façons de faire : glisser sur la frise, ou marquer les bornes ' +
          'au vol pendant que le morceau joue.';

    if (active && duration) {
      const left = (loop.a! / duration) * 100;
      const width = ((loop.b! - loop.a!) / duration) * 100;

      loopBand.classList.remove('hidden');
      loopBand.style.left = `${left}%`;
      // Sur un morceau long, un passage de quelques secondes ne ferait qu'un
      // cheveu : on lui garantit une largeur minimale, sans quoi la mise en
      // lumière ne montrerait rien.
      loopBand.style.width = `max(3px, ${width}%)`;
      tickA.classList.remove('hidden');
      tickA.style.left = `${left}%`;
      tickB.classList.remove('hidden');
      tickB.style.left = `${left + width}%`;
      scrimBefore.classList.remove('hidden');
      scrimBefore.style.width = `${left}%`;
      scrimAfter.classList.remove('hidden');
      scrimAfter.style.width = `${Math.max(0, 100 - left - width)}%`;

      laneSelection.classList.remove('hidden');
      laneSelection.style.left = `${left}%`;
      laneSelection.style.width = `max(6px, ${width}%)`;
      handleA.classList.remove('hidden');
      handleA.style.left = `${left}%`;
      handleB.classList.remove('hidden');
      handleB.style.left = `${left + width}%`;

      loopBadge.classList.remove('hidden');
      const range = `${formatTime(loop.a!)} – ${formatTime(loop.b!)}`;
      loopBadge.textContent = draftLoop
        ? `🔁 ${range}`
        : `🔁 ${range}${laps > 0 ? ` · ${laps}\u00A0fois` : ''}`;
    } else {
      const hidden = [loopBand, tickA, tickB, scrimBefore, scrimAfter,
        laneSelection, handleA, handleB, loopBadge];
      for (const node of hidden) {
        node.classList.add('hidden');
      }
    }
  }

  // --- Frise de tracé -----------------------------------------------------

  /**
   * Tracer la boucle à la souris plutôt que de la poser à l'oreille : on
   * désigne directement l'intervalle. La frise est distincte de la barre de
   * défilement — glisser sur celle-ci déplace la lecture, et les deux gestes
   * ne peuvent pas partager la même surface.
   */
  const laneRail = el('div', {
    class:
      'absolute inset-x-0 inset-y-1 rounded-lg border border-zinc-600 bg-zinc-800/70',
  });
  /**
   * Invite écrite dans la frise vide. Une zone de glissement ne s'annonce pas
   * d'elle-même : le mode d'emploi tient dans le contrôle, pas à côté.
   */
  const lanePrompt = el(
    'div',
    {
      class:
        'pointer-events-none absolute inset-0 flex items-center justify-center ' +
        'px-3 text-center text-xs text-zinc-400',
    },
    'Glissez ici pour choisir le passage à répéter',
  );
  const laneSelection = el('div', {
    class: 'absolute inset-y-2 hidden rounded-lg bg-amber-400/25 ring-1 ring-amber-400/50',
  });
  const lanePlayhead = el('div', {
    class: 'pointer-events-none absolute inset-y-1 w-0.5 rounded bg-zinc-100',
  });

  /**
   * Poignée de bord. Elle porte une prise — deux traits verticaux, la forme
   * universelle du « ça se tire » — plutôt qu'une lettre à décoder. Les temps
   * correspondants sont écrits en toutes lettres sous la frise.
   */
  function laneHandle(edge: 'a' | 'b', name: string): HTMLElement {
    return el(
      'div',
      {
        class:
          'absolute inset-y-0 z-10 hidden w-8 -translate-x-1/2 cursor-ew-resize ' +
          'items-center justify-center',
        'data-handle': edge,
        role: 'button',
        tabindex: 0,
        'aria-label': `Déplacer ${name} du passage répété`,
      },
      el(
        'div',
        {
          class:
            'flex h-8 w-3.5 items-center justify-center gap-[2px] rounded ' +
            'bg-amber-400 shadow ring-1 ring-amber-200/60',
        },
        el('span', { class: 'h-3 w-px bg-zinc-900/50' }),
        el('span', { class: 'h-3 w-px bg-zinc-900/50' }),
      ),
    );
  }
  const handleA = laneHandle('a', 'le début');
  const handleB = laneHandle('b', 'la fin');
  // `flex` est retiré par `hidden` : on le repose à l'affichage.
  for (const h of [handleA, handleB]) h.classList.add('flex');

  const lane = el(
    'div',
    {
      class: 'loop-lane relative h-11 w-full touch-none select-none',
      role: 'group',
      'aria-label': 'Frise du morceau : glissez pour choisir le passage à répéter',
    },
    laneRail,
    laneSelection,
    lanePrompt,
    lanePlayhead,
    handleA,
    handleB,
  );

  type DragMode = { kind: 'create'; anchor: number } | { kind: 'edge'; edge: 'a' | 'b' };
  let laneDrag: DragMode | null = null;

  const laneTime = (event: PointerEvent): number => {
    const rect = laneRail.getBoundingClientRect();
    if (!rect.width || !duration) return 0;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  lane.addEventListener('pointerdown', (event) => {
    if (!duration) return;
    const target = event.target as HTMLElement;
    const edge = target.closest('[data-handle]')?.getAttribute('data-handle');
    const loop = player.getLoop();
    if ((edge === 'a' || edge === 'b') && loop.a !== null && loop.b !== null) {
      laneDrag = { kind: 'edge', edge };
      draftLoop = { a: loop.a, b: loop.b };
    } else {
      const at = laneTime(event);
      laneDrag = { kind: 'create', anchor: at };
      draftLoop = { a: at, b: at };
    }
    lane.setPointerCapture(event.pointerId);
    paintLoop();
  });

  lane.addEventListener('pointermove', (event) => {
    if (!laneDrag || !draftLoop) return;
    const at = laneTime(event);
    if (laneDrag.kind === 'create') {
      draftLoop = { a: Math.min(laneDrag.anchor, at), b: Math.max(laneDrag.anchor, at) };
    } else if (laneDrag.edge === 'a') {
      draftLoop = { a: Math.min(at, draftLoop.b), b: draftLoop.b };
    } else {
      draftLoop = { a: draftLoop.a, b: Math.max(at, draftLoop.a) };
    }
    paintLoop();
  });

  const endLaneDrag = (commit: boolean): void => {
    if (!laneDrag) return;
    const draft = draftLoop;
    laneDrag = null;
    draftLoop = null;
    // Un simple clic ne trace rien : sans cette garde, il poserait une boucle
    // de durée nulle et couperait la lecture.
    if (commit && draft && draft.b - draft.a >= 0.25) {
      player.setLoop(draft.a, draft.b);
      player.play();
    }
    paintLoop();
  };
  lane.addEventListener('pointerup', () => endLaneDrag(true));
  lane.addEventListener('pointercancel', () => endLaneDrag(false));
  disposers.push(() => endLaneDrag(false));

  /**
   * Ajustement fin d'une borne. Sans repère structurel dans le manifeste, la
   * boucle ne se cale sur le temps fort qu'à la main : le tap donne le demi-
   * seconde, l'appui long balaie par pas de deux secondes.
   */
  function nudgeButton(point: 'a' | 'b', direction: -1 | 1): HTMLButtonElement {
    const button = el(
      'button',
      {
        type: 'button',
        class: ui.icon,
        'aria-label': `${direction < 0 ? 'Reculer' : 'Avancer'} le point ${point.toUpperCase()}`,
      },
      // Sélecteur de variante : sans lui, la flèche part en emoji couleur.
      direction < 0 ? '\u25C0\uFE0E' : '\u25B6\uFE0E',
    );

    let holdTimer: number | null = null;
    let repeatTimer: number | null = null;
    let held = false;

    const stop = (): void => {
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      if (repeatTimer !== null) window.clearInterval(repeatTimer);
      holdTimer = repeatTimer = null;
    };

    button.addEventListener('pointerdown', (event) => {
      held = false;
      button.setPointerCapture(event.pointerId);
      holdTimer = window.setTimeout(() => {
        held = true;
        player.nudgeLoopPoint(point, direction * NUDGE_HOLD);
        paintLoop();
        repeatTimer = window.setInterval(() => {
          player.nudgeLoopPoint(point, direction * NUDGE_HOLD);
          paintLoop();
        }, HOLD_REPEAT_MS);
      }, HOLD_DELAY_MS);
    });
    const release = (): void => {
      stop();
      // Un appui long a déjà agi : on ne rajoute pas le pas du tap par-dessus.
      if (!held) player.nudgeLoopPoint(point, direction * NUDGE_TAP);
      paintLoop();
      held = false;
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', stop);
    disposers.push(stop);
    return button;
  }

  /** Une borne nommée, avec son temps et son réglage fin. */
  function loopBound(point: 'a' | 'b', name: string, label: HTMLElement): HTMLElement {
    return el(
      'div',
      { class: 'flex items-center gap-1.5' },
      el('span', { class: 'text-xs text-zinc-400' }, name),
      label,
      nudgeButton(point, -1),
      nudgeButton(point, 1),
    );
  }

  const loopBounds = el(
    'div',
    { class: 'hidden flex-wrap items-center gap-x-4 gap-y-2' },
    loopBound('a', 'Début', aLabel),
    loopBound('b', 'Fin', bLabel),
  );

  /**
   * Un seul bouton pour marquer les bornes à l'oreille, dont le libellé dit
   * toujours ce que fera le prochain appui : commencer, terminer, ou arrêter.
   * C'est le fonctionnement d'une pédale de boucle, déjà familier.
   */
  const markButton = el('button', { type: 'button', class: ui.buttonActive }, '');
  markButton.addEventListener('click', () => {
    const loop = player.getLoop();
    if (loop.a !== null && loop.b !== null) player.clearLoop();
    else if (loop.a !== null) player.markLoopPoint('b');
    else player.markLoopPoint('a');
    paintLoop();
  });

  // --- Saut à froid et ghost mode -----------------------------------------

  const countdown = el('div', {
    class:
      'pointer-events-none fixed inset-0 z-40 hidden items-center justify-center ' +
      'bg-zinc-950/90 text-8xl font-bold text-amber-300 backdrop-blur-sm',
  });
  document.body.appendChild(countdown);

  const jumpButton = el(
    'button',
    { type: 'button', class: ui.button, disabled: !anySource },
    '🎲 Reprendre au hasard',
  );
  jumpButton.addEventListener('click', () => {
    countdown.classList.remove('hidden');
    countdown.classList.add('flex');
    player.coldJump((remaining) => {
      countdown.textContent = remaining > 0 ? String(remaining) : 'Jouez !';
      if (remaining === 0) {
        window.setTimeout(() => {
          countdown.classList.add('hidden');
          countdown.classList.remove('flex');
        }, 600);
      }
    });
  });

  const ghostButton = el('button', { type: 'button', class: ui.button }, '👻 Écoute aveugle');
  ghostButton.addEventListener('click', () => {
    ghost = !ghost;
    // Ghost mode : plus de position ni de durée. Sans repère visuel, on ne
    // peut plus anticiper la structure — il faut écouter.
    seekBar.classList.toggle('invisible', ghost);
    currentLabel.classList.toggle('invisible', ghost);
    durationLabel.classList.toggle('invisible', ghost);
    ghostButton.className = ghost ? ui.buttonActive : ui.button;
    ghostButton.textContent = ghost ? '👻 Écoute aveugle (active)' : '👻 Écoute aveugle';
  });

  // --- Sections secondaires -----------------------------------------------

  const sections: Section[] = [];

  if (anySource) {
    sections.push({
      title: 'Ce que vous écoutez',
      body: el('div', { class: 'flex gap-2' }, ...sourceButtons.values()),
    });
  }

  if (song.instruments.length > 1) {
    sections.push({
      title: 'Votre instrument',
      body: el('div', { class: 'flex flex-wrap gap-2' }, ...instrumentButtons.values()),
    });
  }

  if (anySource) {
    sections.push({
      title: 'Répéter un passage',
      hint: 'Un endroit difficile, rejoué sans fin jusqu’à ce que vous l’arrêtiez.',
      body: el(
        'div',
        { class: 'flex min-w-[18rem] flex-col gap-2' },
        lane,
        loopBounds,
        markButton,
        loopHint,
      ),
    });
    sections.push({
      title: 'Se mettre à l’épreuve',
      body: el(
        'div',
        { class: 'flex flex-col gap-2' },
        el('div', { class: 'flex flex-wrap gap-2' }, jumpButton, ghostButton),
        el(
          'p',
          { class: 'text-[11px] leading-snug text-zinc-500' },
          'Au hasard : reprise en plein morceau, après un décompte. ' +
            'Aveugle : la position est cachée, il faut suivre à l’oreille.',
        ),
      ),
    });
  }

  // --- Synchronisation ----------------------------------------------------

  const unsubscribe = player.onTick((tick) => {
    duration = tick.duration;
    durationLabel.textContent = formatTime(duration);
    seekBar.setAttribute('aria-valuemax', String(Math.round(duration)));
    playIcon.textContent = tick.playing ? '❚❚' : '▶';
    playButton.classList.toggle('pl-1', !tick.playing);
    if (!scrubbing) {
      const ratio = duration ? tick.currentTime / duration : 0;
      paintProgress(ratio, tick.currentTime);
      lanePlayhead.style.left = `${ratio * 100}%`;
    }
    laps = tick.laps;
    paintLoop();
    // Éclair bref au moment exact du retour en A : c'est là que l'utilisateur
    // doit comprendre, sans lire, que la boucle vient de reboucler.
    if (tick.wrapped) {
      loopBand.classList.remove('loop-band--wrap');
      void loopBand.offsetWidth; // force le redémarrage de l'animation
      loopBand.classList.add('loop-band--wrap');
    }
  });

  paintLoop();

  return {
    primary,
    sections,
    loadSource,
    destroy: () => {
      unsubscribe();
      disposers.forEach((dispose) => dispose());
      countdown.remove();
    },
  };
}
