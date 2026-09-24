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

import {
  captionedValue,
  createPlayButton,
  createPlayerDock,
  createSeekBar,
  createSeekRow,
  createSkipButton,
  createSourceToggle,
  DOCK_CHIP_MOBILE,
  el,
  paintToggle,
  renderRateStepper,
  ui,
} from './dom';
import type { Player } from './audio';
import { formatTime } from './audio';
import type { AudioKind, Song } from './types';

/** Bloc de réglages secondaires, avec son intitulé. */
export interface Section {
  title: string;
  /** Une phrase disant à quoi sert le réglage — le titre seul ne suffit pas. */
  hint?: string;
  body: HTMLElement;
  /** N'apparaît que sous 768px — pour un réglage déjà visible en direct dans
   *  l'en-tête desktop, qui n'a pas besoin d'un second accès redondant (#153). */
  mobileOnly?: boolean;
}

export interface TransportOptions {
  song: Song;
  player: Player;
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
  let duration = 0;

  const hasSource = (kind: AudioKind): boolean => song.audio[kind] !== null;
  const anySource = hasSource('reference') || hasSource('playback');
  if (!hasSource(source) && anySource) source = 'playback';

  const disposers: Array<() => void> = [];

  // --- Lecture ------------------------------------------------------------

  const play = createPlayButton({
    onToggle: () => player.togglePlay(),
    disabled: !anySource,
  });
  const playButton = play.root;

  // Reculer/avancer de 5 s : mobile seulement, où la piste se vise au doigt
  // (#153). Au-delà, la souris y suffit et le dock reste tel qu'il était.
  const skip = (delta: number): void => player.seekTo(player.getCurrentTime() + delta);
  const backButton = createSkipButton({
    direction: -1, seconds: 5, onSkip: skip, disabled: !anySource, extra: 'md:hidden',
  });
  const forwardButton = createSkipButton({
    direction: 1, seconds: 5, onSkip: skip, disabled: !anySource, extra: 'md:hidden',
  });

  // --- Défilement ---------------------------------------------------------

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

  const currentLabel = el(
    'span',
    { class: 'shrink-0 font-mono text-xs text-zinc-400' },
    '0:00',
  );
  const durationLabel = el(
    'span',
    { class: 'shrink-0 font-mono text-xs text-zinc-500' },
    '0:00',
  );

  // --- Parties repérées dans l'audio -------------------------------------
  //
  // Une pastille par passe (A, A, B…) repérée par `detect_sections.py` : la
  // toucher saute au début de la passe et lance la lecture. Volontairement
  // brut : de quoi juger à l'oreille la qualité du découpage avant d'en
  // soigner l'allure.
  const partsBar = el('div', { class: 'hidden flex-wrap items-center gap-1' });
  const ACTIVE_PART = ['ring-1', 'ring-amber-400', 'text-amber-300'];
  let partButtons: HTMLButtonElement[] = [];
  let activePart = -1;

  const currentParts = () => song.audio[source]?.sections ?? [];

  function paintParts(): void {
    const audio = song.audio[source];
    const parts = currentParts();
    partButtons = parts.map((part) => {
      const button = el(
        'button',
        {
          type: 'button',
          class:
            'rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300 ' +
            'transition hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 ' +
            'focus-visible:ring-amber-400',
          'aria-label': `Aller à la partie ${part.part}, ${formatTime(part.start)}`,
        },
        part.part,
        el('span', { class: 'ml-1 font-mono font-normal text-zinc-500' }, formatTime(part.start)),
      );
      button.addEventListener('click', () => {
        player.seekTo(part.start);
        if (!player.isPlaying()) player.togglePlay();
      });
      return button;
    });
    const doubt =
      audio?.sections_confidence === 'low'
        ? el('span', { class: 'text-[11px] text-amber-300' }, 'découpage douteux')
        : null;
    partsBar.replaceChildren(...partButtons, ...(doubt ? [doubt] : []));
    partsBar.classList.toggle('hidden', parts.length === 0);
    partsBar.classList.toggle('flex', parts.length > 0);
    activePart = -1;
  }

  /** Souligne la passe en cours d'écoute. */
  function paintActivePart(seconds: number): void {
    const index = currentParts().findIndex((part) => seconds >= part.start && seconds < part.end);
    if (index === activePart) return;
    partButtons[activePart]?.classList.remove(...ACTIVE_PART);
    partButtons[index]?.classList.add(...ACTIVE_PART);
    activePart = index;
  }

  // Géométrie et geste viennent de `dom.ts`, partagés avec le filage ; les
  // décorations de boucle restent propres à l'entraînement et se rangent
  // dans la piste que la primitive expose (#137).
  const seek = createSeekBar({
    onSeek: (seconds) => player.seekTo(seconds),
    onPaint: (ratio, seconds) => {
      currentLabel.textContent = formatTime(seconds);
      lanePlayhead.style.left = `${ratio * 100}%`;
      paintActivePart(seconds);
    },
    decorations: [loopBand, scrimBefore, scrimAfter, tickA, tickB],
  });
  const seekBar = seek.root;

  /**
   * Résumé de la boucle en cours, entre position et durée. C'est aussi le
   * bouton qui l'arrête : « 🔁 0:12 – 0:20 · 3 fois  ✕ ».
   */
  const loopBadge = el('button', {
    type: 'button',
    class:
      'hidden min-w-0 shrink self-center truncate rounded px-1.5 text-[11px] font-medium ' +
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
  /** Masqué avec la frise : vide, sa marge rallongeait encore le dock. */
  const laneSlotBar = el('div', { class: 'mt-0.5 hidden' });

  // Les temps encadrent la piste au lieu d'occuper une ligne à eux seuls :
  // une ligne de moins dans un dock qui en avait trois (#9, #137) ; sur
  // mobile, ils passent dessous (`createSeekRow`, #153). Le résumé
  // de boucle ne descend en dessous que lorsqu'il y a une boucle à résumer —
  // masqué, il n'est pas un élément de la colonne et n'y ajoute aucun espace.
  const seekRow = el(
    'div',
    { class: 'flex min-w-0 flex-1 flex-col gap-0.5' },
    createSeekRow(seekBar, currentLabel, durationLabel),
    partsBar,
    laneSlotBar,
    loopBadge,
  );

  // --- Vitesse ----------------------------------------------------------
  //
  // Un stepper (−, valeur, +) plutôt que des paliers fixes : la vitesse
  // ralentie sert à déchiffrer un passage, puis on revient au tempo réel
  // d'un tap sur la valeur. Widget partagé avec l'écran de filage
  // (`renderRateStepper`, `dom.ts`).
  //
  // Tempo détecté automatiquement (#111) : quand il est connu pour la
  // source active, le stepper affiche et décale une cible en BPM plutôt
  // qu'un pourcentage de vitesse — vocabulaire de musicien. Absent tant que
  // `scripts/detect_bpm.py` n'a pas tourné sur la source active ; suit la
  // bascule Original/Playback via `rateStepper.refresh()`, appelé au clic
  // de `sourceButton` plus bas.
  const rateStepper = renderRateStepper(player, { getBpm: () => song.audio[source]?.bpm ?? null });
  const rateGroup = el(
    'div',
    // Replié en pastille « Vitesse » sur mobile (`rateStepper.compact`).
    { class: 'flex shrink-0 items-center gap-1 max-md:hidden' },
    rateStepper.minus,
    rateStepper.value,
    rateStepper.plus,
  );

  // --- Enregistrement ---------------------------------------------------
  //
  // Aller-retour constant, et non un réglage qu'on pose une fois :
  // l'accompagnateur travaille sur l'enregistrement complet, le soliste sur
  // l'accompagnement seul, mais revient au thème pour se le remettre en tête.
  // Une seule bascule, à portée immédiate.

  const sourceCycle = (['reference', 'playback'] as AudioKind[]).filter(hasSource);

  function loadSource(autoplay = false): void {
    const audio = song.audio[source];
    if (audio) player.load(audio.file, autoplay, audio.duration);
    player.clearLoop();
    paintLoop();
    paintParts();
  }

  const sourceToggle = createSourceToggle({
    available: sourceCycle,
    current: source,
    onPick: (kind) => {
      source = kind;
      rateStepper.refresh();
      // On enchaîne si l'on jouait : s'arrêter à chaque bascule casserait le fil.
      loadSource(player.isPlaying());
    },
  });
  const sourceButton = sourceToggle.root;

  // --- Frise de tracé, bascule -------------------------------------------
  //
  // La frise (tracé du passage à répéter) reste hors champ tant qu'on ne
  // s'en sert pas : elle prenait de la place en permanence pour un geste
  // occasionnel (issue #120). Le bouton la révèle ; l'état de la boucle en
  // cours, lui, reste toujours lisible via `loopBadge`, indépendamment.
  const loopState = el('span', { class: 'text-[13px] font-semibold leading-none' });
  const loopToggle = el(
    'button',
    { type: 'button', class: ui.chip, 'aria-expanded': 'false' },
    el(
      'span',
      { class: 'inline-flex items-center gap-1.5 max-md:hidden' },
      el('span', { 'aria-hidden': 'true' }, '🔁'),
      'Loop',
    ),
    captionedValue('Boucle', loopState),
  );

  // --- Assemblage de la barre principale ---------------------------------
  //
  // Deux rangées sous 768 px — la piste pleine largeur, puis lecture et
  // réglages —, une seule au-delà (#153). `createPlayerDock` porte cette
  // bascule de disposition.

  const settings: HTMLElement[] = [];
  if (sourceCycle.length > 1) settings.push(sourceButton);
  settings.push(rateGroup, rateStepper.compact);
  if (anySource) settings.push(loopToggle);

  const primary = createPlayerDock({
    seek: seekRow,
    transport: [backButton, playButton, forwardButton],
    settings,
  });

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

  /** Valeur de la pastille mobile « Boucle » : une boucle qui tourne prime
   *  sur l'état de la frise. */
  function paintLoopState(): void {
    const loop = player.getLoop();
    loopState.textContent =
      loop.a !== null && loop.b !== null ? 'En cours' : laneOpen ? 'Tracer' : 'Non';
  }

  function paintLoop(): void {
    const loop = shownLoop();
    const active = loop.a !== null && loop.b !== null;
    const signature = `${loop.a}|${loop.b}|${duration}|${laps}|${!!draftLoop}`;
    if (signature === paintedLoop) return;
    paintedLoop = signature;
    paintLoopState();

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
      class: 'loop-lane relative h-11 w-full touch-none select-none md:h-[22px]',
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

  /** Repliée par défaut : voir le commentaire sur `loopToggle`. */
  let laneOpen = false;
  function paintLoopToggle(): void {
    lane.classList.toggle('hidden', !laneOpen);
    laneSlotBar.classList.toggle('hidden', !laneOpen);
    paintToggle(loopToggle, laneOpen, 'chip', DOCK_CHIP_MOBILE);
    paintLoopState();
    loopToggle.setAttribute('aria-expanded', String(laneOpen));
    loopToggle.setAttribute(
      'aria-label',
      laneOpen ? 'Masquer la frise de répétition' : 'Afficher la frise pour répéter un passage',
    );
  }
  loopToggle.addEventListener('click', () => {
    laneOpen = !laneOpen;
    paintLoopToggle();
  });
  paintLoopToggle();

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
    play.set(tick.playing);
    // `seek.set` ne peint pas pendant un glissement — le doigt prime — et
    // c'est `onPaint` qui tient le libellé et la tête de lecture à jour.
    seek.set(tick.currentTime, duration);
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
  paintParts();

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
