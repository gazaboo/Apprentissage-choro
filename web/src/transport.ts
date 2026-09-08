/** Barre de transport : tout le pilotage du lecteur, en boutons visibles.
 *
 * L'application s'adresse à des musiciens, pas à des utilisateurs de clavier :
 * il n'y a aucun raccourci, et toute action doit se voir et s'atteindre au
 * doigt. La barre expose donc explicitement ce qui était autrefois caché
 * derrière des touches — enregistrement, vitesse, transposition — chacun
 * ramené à une seule bascule qui affiche l'état courant. Sous la piste, une
 * frise permet de tracer le passage à répéter.
 *
 * Elle produit deux groupes de nœuds : `primary` (lecture, défilement,
 * bascules, frise), toujours visible, et `sections` (explications et réglages
 * fins), que la vue place dans le panneau de réglages.
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

export function createTransport(options: TransportOptions): Transport {
  const { song, player } = options;

  let source: AudioKind = song.audio.reference ? 'reference' : 'playback';
  let instrumentId: InstrumentId = song.instruments[0]!.id;
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

  /**
   * Résumé de la boucle en cours, entre position et durée. C'est aussi le
   * bouton qui l'arrête : « 🔁 0:12 – 0:20 · 3 fois  ✕ ».
   */
  const loopBadge = el('button', {
    type: 'button',
    class:
      'hidden min-w-0 shrink truncate rounded px-1.5 text-[11px] font-medium ' +
      'text-amber-300 transition hover:text-amber-200 focus:outline-none ' +
      'focus-visible:ring-2 focus-visible:ring-amber-400',
    'aria-label': 'Arrêter de répéter le passage',
    title: 'Toucher pour arrêter la boucle',
  });
  loopBadge.addEventListener('click', () => {
    draftLoop = null;
    player.clearLoop();
    paintLoop();
  });

  /** Reçoit la frise de tracé, juste sous la piste. */
  const laneSlotBar = el('div', { class: 'mt-0.5' });

  const seekRow = el(
    'div',
    { class: 'order-1 flex min-w-0 flex-1 flex-col gap-0.5 lg:order-2' },
    seekBar,
    laneSlotBar,
    el(
      'div',
      { class: 'flex items-center justify-between gap-2' },
      currentLabel,
      loopBadge,
      durationLabel,
    ),
  );

  // --- Vitesse ----------------------------------------------------------
  //
  // Un seul bouton, pas trois : la vitesse ralentie sert à déchiffrer un
  // passage, puis on revient au tempo réel. Chaque appui descend d'un cran
  // (1× → 0.75× → 0.5×) puis reboucle au plein tempo — le fonctionnement
  // d'une pédale. Hors 1×, le bouton s'allume pour qu'on n'oublie pas.

  // Du plus lent au plus rapide dans le manifeste ; on veut l'ordre inverse
  // pour le cycle (partir du plein tempo et ralentir).
  const RATE_CYCLE = [...PLAYBACK_RATES].sort((a, b) => b - a);

  let rateIndex = 0;
  const rateButton = el('button', { type: 'button', class: ui.chip }, '');
  function paintRate(): void {
    const rate = RATE_CYCLE[rateIndex]!;
    // `className` complet à chaque fois : le rang `lg:order-4` doit survivre.
    rateButton.className = `${rate === 1 ? ui.chip : ui.chipActive} lg:order-4`;
    rateButton.textContent = `${rate}×`;
    rateButton.setAttribute(
      'aria-label',
      `Vitesse ${rate} fois, toucher pour ${rate === 1 ? 'ralentir' : 'changer'}`,
    );
  }
  rateButton.addEventListener('click', () => {
    rateIndex = (rateIndex + 1) % RATE_CYCLE.length;
    player.setRate(RATE_CYCLE[rateIndex]!);
    paintRate();
  });
  paintRate();

  // --- Enregistrement ---------------------------------------------------
  //
  // Aller-retour constant, et non un réglage qu'on pose une fois :
  // l'accompagnateur travaille sur l'enregistrement complet, le soliste sur
  // l'accompagnement seul, mais revient au thème pour se le remettre en tête.
  // Une seule bascule, à portée immédiate.

  const SOURCE_LABELS: Record<AudioKind, string> = {
    reference: 'Original',
    playback: 'Playback',
  };
  const SOURCE_HINTS: Record<AudioKind, string> = {
    reference: 'Enregistrement original, thème compris',
    playback: 'Accompagnement seul, sans le thème',
  };
  const sourceCycle = (['reference', 'playback'] as AudioKind[]).filter(hasSource);

  function loadSource(autoplay = false): void {
    const audio = song.audio[source];
    if (audio) player.load(audio.youtube_id, autoplay);
    player.clearLoop();
    paintLoop();
  }

  const sourceButton = el('button', { type: 'button', class: ui.chip }, '');
  function paintSourceButton(): void {
    sourceButton.textContent = SOURCE_LABELS[source];
    sourceButton.title = SOURCE_HINTS[source];
    sourceButton.setAttribute(
      'aria-label',
      sourceCycle.length > 1
        ? `${SOURCE_HINTS[source]} — toucher pour changer`
        : SOURCE_HINTS[source],
    );
  }
  sourceButton.addEventListener('click', () => {
    if (sourceCycle.length < 2) return;
    source = sourceCycle[(sourceCycle.indexOf(source) + 1) % sourceCycle.length]!;
    paintSourceButton();
    // On enchaîne si l'on jouait : s'arrêter à chaque bascule casserait le fil.
    loadSource(player.isPlaying());
  });
  sourceButton.classList.add('lg:order-3');
  paintSourceButton();

  // --- Transposition --------------------------------------------------------
  //
  // Une bascule de plus, du même moule : on passe d'une tonalité à l'autre au
  // tap, sans quitter la partition des yeux.

  const INSTRUMENT_CHIP: Record<InstrumentId, string> = {
    c: 'Ut',
    bb: 'Si♭',
    eb: 'Mi♭',
  };
  const instrumentIds = song.instruments.map((instrument) => instrument.id);
  const instrumentName = (id: InstrumentId): string =>
    song.instruments.find((instrument) => instrument.id === id)?.name ?? id;

  const instrumentButton = el('button', { type: 'button', class: ui.chip }, '');
  function paintInstrumentButton(): void {
    instrumentButton.textContent = INSTRUMENT_CHIP[instrumentId] ?? instrumentId;
    instrumentButton.title = instrumentName(instrumentId);
    instrumentButton.setAttribute(
      'aria-label',
      `Transposition ${instrumentName(instrumentId)} — toucher pour changer`,
    );
  }
  instrumentButton.addEventListener('click', () => {
    const i = instrumentIds.indexOf(instrumentId);
    instrumentId = instrumentIds[(i + 1) % instrumentIds.length]!;
    paintInstrumentButton();
    options.onInstrument(instrumentId);
  });
  instrumentButton.classList.add('lg:order-5');
  paintInstrumentButton();

  // --- Assemblage de la barre principale ---------------------------------
  //
  // Sous 1024 px, la piste prend toute la largeur sur une première ligne et
  // les bascules se rangent dessous ; `flex-wrap` évite tout débordement si
  // l'écran est vraiment étroit.

  const secondary: HTMLElement[] = [];
  if (sourceCycle.length > 1) secondary.push(sourceButton);
  secondary.push(rateButton);
  if (song.instruments.length > 1) secondary.push(instrumentButton);

  const primary = el(
    'div',
    { class: 'flex w-full flex-col gap-1 lg:flex-row lg:items-center lg:gap-3' },
    seekRow,
    el(
      'div',
      // `lg:contents` efface cette enveloppe sur grand écran : ses enfants
      // redeviennent alors des éléments de la rangée et suivent leur `order`.
      { class: 'order-2 flex flex-wrap items-center gap-2 lg:contents' },
      playButton,
      ...secondary,
    ),
  );
  playButton.classList.add('lg:order-1');

  // --- Répéter un passage : tracé sur la frise ---------------------------
  //
  // « A » et « B » nomment le mécanisme, pas l'intention : personne ne cherche
  // une boucle A-B, on cherche à faire tourner un passage. Le geste principal
  // — tracer le passage sur la frise — s'annonce lui-même dans la frise vide.

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

    lanePrompt.classList.toggle('hidden', active || !!draftLoop);
    laneRail.classList.toggle('border-dashed', !active);

    if (active && duration) {
      const left = (loop.a! / duration) * 100;
      const width = ((loop.b! - loop.a!) / duration) * 100;

      loopBand.classList.remove('hidden');
      loopBand.style.left = `${left}%`;
      // Sur un morceau long, un passage de quelques secondes ne ferait qu'un
      // cheveu : on lui garantit une largeur minimale.
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
        : `🔁 ${range}${laps > 0 ? ` · ${laps} fois` : ''}  ✕`;
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
        'px-3 text-center text-[11px] text-zinc-500',
    },
    'Glissez ici pour choisir le passage à répéter',
  );
  const laneSelection = el('div', {
    // Saisissable : on déplace le passage sans en changer la durée, ce qui est
    // le geste courant quand on s'est trompé de mesure d'une croche.
    class:
      'loop-selection absolute inset-y-2 hidden rounded-lg bg-amber-400/25 ' +
      'ring-1 ring-amber-400/50',
    'data-loop-band': '',
  });
  const lanePlayhead = el('div', {
    class: 'pointer-events-none absolute inset-y-1 w-0.5 rounded bg-zinc-100',
  });

  /**
   * Poignée de bord. Elle porte une prise — deux traits verticaux, la forme
   * universelle du « ça se tire » — plutôt qu'une lettre à décoder.
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
      // 44 px sur petit écran, où l'on vise au doigt ; 22 px collés sous la
      // piste sur grand écran, où la souris n'a pas besoin d'autant.
      class: 'loop-lane relative h-11 w-full touch-none select-none lg:h-[22px]',
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
  laneSlotBar.appendChild(lane);

  type DragMode =
    | { kind: 'create'; anchor: number }
    | { kind: 'edge'; edge: 'a' | 'b' }
    | { kind: 'move'; offset: number; span: number };
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
    const onBand = target.closest('[data-loop-band]') !== null;
    const loop = player.getLoop();
    if ((edge === 'a' || edge === 'b') && loop.a !== null && loop.b !== null) {
      laneDrag = { kind: 'edge', edge };
      draftLoop = { a: loop.a, b: loop.b };
    } else if (onBand && loop.a !== null && loop.b !== null) {
      laneDrag = {
        kind: 'move',
        offset: laneTime(event) - loop.a,
        span: loop.b - loop.a,
      };
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
    } else if (laneDrag.kind === 'move') {
      // La durée est préservée ; seules les bornes du morceau bornent la course.
      const span = laneDrag.span;
      const a = Math.min(Math.max(0, at - laneDrag.offset), Math.max(0, duration - span));
      draftLoop = { a, b: a + span };
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

  // --- Sections secondaires -----------------------------------------------

  const sections: Section[] = [];

  if (anySource) {
    sections.push({
      title: 'Répéter un passage',
      body: el(
        'p',
        { class: 'text-xs leading-relaxed text-zinc-400' },
        'Tracez le passage sur la frise, juste sous la barre de lecture : un ' +
          'glissement en pose les deux bords. Tirez-les ensuite pour ajuster, ' +
          'ou touchez le résumé « 🔁 » pour arrêter.',
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
    },
  };
}
