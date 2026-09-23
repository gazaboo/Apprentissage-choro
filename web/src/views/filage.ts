/** Filage : la setlist enchaînée comme en concert.
 *
 * Chaque morceau est joué avec sa bande (accompagnateur → enregistrement
 * original ; soliste Si♭/Mi♭ → playback). À la fin de l'audio, un décompte de
 * 5 secondes annonce le morceau suivant, puis la lecture reprend seule.
 *
 * La zone d'étude passe par trois états, dans cet ordre : partition, grille
 * d'accords, puis scène (titre en grand). Un seul bouton les fait défiler,
 * comme les bascules de la barre de transport — sur un dock déjà chargé, trois
 * boutons de plus ne tiendraient pas sur un téléphone. Un état sans contenu
 * pour le morceau courant est sauté : inutile de proposer une grille absente.
 */

import { dockShell } from '../sheet';
import {
  createPlayButton,
  createPlayerDock,
  captionedValue,
  createTopBarIdentity,
  DOCK_CHIP_MOBILE,
  createSeekBar,
  createSeekRow,
  createSkipButton,
  createSourceToggle,
  el,
  iconLabel,
  renderRateStepper,
  ui,
} from '../dom';
import { GrilleView } from '../grille';
import { ScoreView } from '../score';
import type { AudioKind, Grille, InstrumentId, Song } from '../types';
import { INSTRUMENT_SHORT_LABELS, isGrille } from '../types';
import type { Player } from '../audio';
import { formatTime } from '../audio';

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
const INTRO_COUNTDOWN_S = 10;

/** Les trois états de la zone principale, dans l'ordre du cycle. */
type FilageView = 'partition' | 'grille' | 'scene';

const VIEW_ORDER: FilageView[] = ['partition', 'grille', 'scene'];

/** Le bouton annonce ce que fera l'appui suivant, non l'état courant. */
const NEXT_VIEW_LABELS: Record<FilageView, string> = {
  partition: 'Voir la partition',
  grille: 'Voir la grille',
  scene: 'Masquer la partition',
};
/** Icône associée à chaque libellé ci-dessus, au-delà de 768 px (#150). */
const NEXT_VIEW_ICONS: Record<FilageView, string> = {
  partition: '♪',
  grille: '▦',
  scene: '⊘',
};
/** Ce que montre la zone principale, pour la pastille « Affichage » mobile :
 *  elle dit l'état courant, comme la pastille « Bande » du dock (#153). */
const VIEW_NAMES: Record<FilageView, string> = {
  partition: 'Partition',
  grille: 'Grille',
  scene: 'Masquée',
};

export function renderFilage(root: HTMLElement, context: FilageContext): () => void {
  const { player, order, instrumentId } = context;

  let audioKind: AudioKind = context.audioKind;
  let index = 0;
  let transitioning = false;
  let hasPlayed = false;
  let countdownTimer: number | null = null;
  /** Ce que montre la zone principale. Voir le commentaire de tête. */
  let view: FilageView = 'partition';
  /** Grille du morceau courant, `null` tant qu'elle n'est pas chargée. */
  let grille: Grille | null = null;
  /** Annule le chargement de grille en cours quand on change de morceau. */
  let grilleAbort = new AbortController();
  let unsubscribe: (() => void) | null = null;

  // Décompte d'entrée : le temps de prendre son instrument avant le 1er morceau.
  let introActive = true;
  let introTimer: number | null = null;

  /** Charge la bande choisie du morceau, avec repli sur l'autre.
   *
   * La durée vient du manifeste : la barre de défilement est juste dès le
   * chargement, sans attendre les métadonnées du fichier.
   */
  function loadAudio(song: Song, autoplay: boolean): void {
    const wantReference = audioKind === 'reference';
    const primary = wantReference ? song.audio.reference : song.audio.playback;
    const fallback = wantReference ? song.audio.playback : song.audio.reference;
    const source = primary ?? fallback;
    if (source) player.load(source.file, autoplay, source.duration);
  }

  // --- DOM ---------------------------------------------------------------

  const playerMount = el('div', { class: 'audio-only' });

  const scoreContainer = el('div', { class: 'score-surface flex flex-col gap-6' });
  const scoreView = new ScoreView(scoreContainer, { onHintUsed: () => {} });
  const scoreNote = el('p', { class: `${ui.card} hidden text-sm text-zinc-400` });

  const grilleContainer = el('div', { class: 'hidden' });
  const grilleView = new GrilleView(grilleContainer, { onHintUsed: () => {} });

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

  // « 0:12 / 3:10 » d'un seul tenant au-delà de 768 px ; en dessous, les deux
  // temps passent sous la piste, aux deux bouts (`createSeekRow`, #153).
  const timeLabel = el('span', {
    class: 'shrink-0 font-mono text-sm text-zinc-400 tabular-nums max-md:hidden',
  }, '0:00 / 0:00');
  const currentLabel = el('span', { class: 'font-mono text-zinc-400 tabular-nums md:hidden' }, '0:00');
  const durationLabel = el('span', { class: 'font-mono text-zinc-500 tabular-nums md:hidden' }, '0:00');
  const play = createPlayButton({ onToggle: () => player.togglePlay() });
  const playButton = play.root;

  const skip = (delta: number): void => player.seekTo(player.getCurrentTime() + delta);
  const backSkip = createSkipButton({ direction: -1, seconds: 5, onSkip: skip, extra: 'md:hidden' });
  const forwardSkip = createSkipButton({ direction: 1, seconds: 5, onSkip: skip, extra: 'md:hidden' });

  // « Passer au suivant » et le cycle de vue vivent dans la barre du haut, à
  // toutes les largeurs : ce sont des gestes de navigation, pas de lecture, et
  // le dock ne garde plus que l'audio (#153, variante 1 des maquettes).
  const nextButton = el(
    'button',
    { type: 'button', class: `${ui.button} gap-1.5 max-md:px-3`, 'aria-label': 'Passer au morceau suivant' },
    el('span', { class: 'md:hidden' }, 'Suivant'),
    el('span', { class: 'max-md:hidden' }, 'Passer au suivant'),
    el('span', { class: 'max-md:hidden', 'aria-hidden': 'true' }, '⏭'),
  );
  nextButton.addEventListener('click', () => startCountdown());

  // --- Barre de lecture : on revient où l'on veut à tout moment ---------

  // Géométrie et geste partagés avec la barre de transport (`createSeekBar`,
  // `dom.ts`). Le filage déplaçait auparavant le lecteur à *chaque* mouvement
  // du doigt ; il suit désormais l'entraînement et n'agit qu'au relâchement —
  // sur un fichier long, relancer le décodage à chaque pixel hache la
  // lecture (#137).
  const seek = createSeekBar({ onSeek: (seconds) => player.seekTo(seconds) });
  const seekBar = seek.root;

  // --- Vitesse : disponible et modifiable à tout moment -----------------
  //
  // Widget partagé avec la barre de transport (`renderRateStepper`, `dom.ts`) :
  // persiste au changement de morceau, comme avant. Affiche une cible en
  // BPM quand le tempo du morceau/bande courant est connu (#111) — suit le
  // morceau et la bascule Original/Playback via `rateStepper.refresh()`.

  const rateStepper = renderRateStepper(player, {
    getBpm: () => order[index]?.audio[audioKind]?.bpm ?? null,
  });

  // --- Bande : original ↔ playback, à tout moment ----------------------

  // Une pastille cyclique, comme dans le dock d'entraînement, au lieu des
  // deux boutons segmentés qui vivaient ici avec leur propre classe ambre —
  // restée hors du vocabulaire de couleur unifié (#137).
  const sourceToggle = createSourceToggle({
    available: ['reference', 'playback'],
    current: audioKind,
    onPick: (kind) => {
      if (transitioning) {
        sourceToggle.set(audioKind);
        return;
      }
      audioKind = kind;
      rateStepper.refresh();
      loadAudio(order[index]!, player.isPlaying());
    },
  });

  // Le cycle de vue : au-delà de 768 px, le bouton annonce l'état suivant
  // (« Voir la grille ») ; en dessous, une pastille légendée dit l'état
  // courant (« Affichage / Partition ») et avance d'un cran au toucher.
  const scoreToggle = el('button', { type: 'button', class: `${ui.button} max-md:hidden` });
  const viewValue = el('span', { class: 'text-[13px] font-semibold leading-none text-zinc-100' });
  const scoreToggleMobile = el(
    'button',
    { type: 'button', class: `${ui.button} md:hidden ${DOCK_CHIP_MOBILE}` },
    captionedValue('Affichage', viewValue),
  );
  for (const button of [scoreToggle, scoreToggleMobile]) {
    button.addEventListener('click', () => {
      view = nextView();
      paintScoreVisibility();
    });
  }

  // Bouton ordinaire, comme « Terminer et évaluer » à l'entraînement : sur cet
  // écran l'action principale est la lecture, et une seule action porte
  // l'ambre plein (#137). En direct au-delà de 1024 px seulement ; en dessous,
  // dans le panneau du titre, loin de « Suivant » avec qui il se confondait
  // (⏹ ⏭, #153).
  const finishButton = el(
    'button',
    { type: 'button', class: `${ui.button} max-lg:hidden`, 'aria-label': 'Terminer le filage' },
    'Terminer le filage',
  );
  finishButton.addEventListener('click', () => context.onFinish());

  // Flèche seule sous 1024 px : entre 768 et 1024, le mot coûtait au titre
  // la place de s'afficher (#153).
  const backButton = el(
    'button',
    { type: 'button', class: `${ui.button} gap-1.5 max-lg:w-10 max-lg:px-0`, 'aria-label': 'Retour' },
    el('span', { 'aria-hidden': 'true' }, '←'),
    el('span', { class: 'max-lg:hidden' }, 'Retour'),
  );
  backButton.addEventListener('click', () => context.navigateHome());

  // Bloc titre : « Filage · 1 sur 3 » au-dessus du morceau, et un panneau
  // avec la suite du filage et sa sortie. Remplace « F..1 / 3 » (préfixe
  // tronqué à deux lettres sur mobile) et la rangée de titre qui suivait (#153).
  const panelUpNext = el('ol', { class: 'flex flex-col gap-1 text-sm text-zinc-300' });
  const panelFinish = el(
    'button',
    { type: 'button', class: `${ui.button} w-full justify-start text-red-300` },
    'Terminer le filage',
  );
  const identity = createTopBarIdentity({
    caption: [''],
    accent: true,
    dot: 'bg-amber-400',
    title: '',
    panelLabel: `Filage · ${context.setlistName}`,
    panel: [
      el(
        'div',
        { class: 'flex flex-col gap-0.5' },
        el('p', { class: 'text-base font-semibold text-zinc-100' }, `Filage · ${context.setlistName}`),
        el('p', { class: 'text-xs text-zinc-500' }, `Rôle : ${INSTRUMENT_SHORT_LABELS[instrumentId]}`),
      ),
      el('p', { class: `${ui.label}` }, 'À suivre'),
      panelUpNext,
      panelFinish,
    ],
  });
  panelFinish.addEventListener('click', () => {
    identity.setOpen(false);
    context.onFinish();
  });

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

  // --- Décompte d'entrée : l'ordre de passage, puis le 1er morceau démarre ---

  const introCount = el('div', {
    class: 'text-6xl font-bold leading-none tabular-nums text-amber-300 sm:text-7xl',
  });
  const introList = el('ol', {
    class:
      'flex max-h-[45vh] w-full max-w-md flex-col gap-1.5 overflow-y-auto ' +
      'rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-left',
  });
  const introVeil = el(
    'div',
    {
      class:
        'fixed inset-0 z-40 hidden cursor-pointer flex-col items-center justify-center ' +
        'gap-5 bg-zinc-950/95 px-6 py-10 backdrop-blur-md',
      role: 'button',
      tabindex: '0',
      'aria-label': 'Démarrer le filage maintenant',
    },
    el('p', { class: 'text-sm uppercase tracking-wider text-zinc-500' }, `Filage · ${context.setlistName}`),
    introCount,
    introList,
    el('p', { class: 'text-sm text-zinc-500' }, 'Appuyez pour démarrer maintenant'),
  );

  function fillIntroList(): void {
    introList.replaceChildren(
      ...order.map((song, i) =>
        el(
          'li',
          { class: 'flex items-baseline gap-3' },
          el('span', { class: 'w-6 shrink-0 font-mono text-sm text-zinc-600' }, String(i + 1)),
          el('span', { class: 'text-base text-zinc-200' }, song.title),
          el('span', { class: 'text-sm text-zinc-500' }, song.composer),
        ),
      ),
    );
  }

  function beginFilage(): void {
    if (!introActive) return;
    introActive = false;
    if (introTimer !== null) window.clearInterval(introTimer);
    introTimer = null;
    window.removeEventListener('keydown', onIntroKey);
    introVeil.classList.add('hidden');
    introVeil.classList.remove('flex');
    loadAudio(order[index]!, true);
  }

  function onIntroKey(event: KeyboardEvent): void {
    if (event.key === 'Tab') return;
    if (event.key === ' ') event.preventDefault();
    beginFilage();
  }

  function startIntro(): void {
    fillIntroList();
    introVeil.classList.remove('hidden');
    introVeil.classList.add('flex');
    let remaining = INTRO_COUNTDOWN_S;
    introCount.textContent = String(remaining);
    introTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        introCount.textContent = String(remaining);
        return;
      }
      beginFilage();
    }, 1000);
    introVeil.addEventListener('pointerdown', beginFilage);
    window.addEventListener('keydown', onIntroKey);
  }

  /** Le morceau courant a-t-il de quoi alimenter cet état ? */
  function available(candidate: FilageView): boolean {
    if (candidate === 'partition') {
      return order[index]?.instruments.some((i) => i.id === instrumentId) ?? false;
    }
    if (candidate === 'grille') return grille !== null;
    return true; // la scène n'a besoin de rien
  }

  /**
   * État suivant du cycle, en sautant ceux qui n'ont rien à montrer. La scène
   * étant toujours disponible, la boucle se termine dans tous les cas.
   */
  function nextView(from: FilageView = view): FilageView {
    let position = VIEW_ORDER.indexOf(from);
    for (let step = 0; step < VIEW_ORDER.length; step += 1) {
      position = (position + 1) % VIEW_ORDER.length;
      const candidate = VIEW_ORDER[position]!;
      if (available(candidate)) return candidate;
    }
    return 'scene';
  }

  function paintScoreVisibility(): void {
    // Un morceau sans partition ne doit pas laisser l'écran vide : on retombe
    // sur l'état suivant qui a quelque chose à montrer.
    if (!available(view)) view = nextView();

    scoreContainer.classList.toggle('hidden', view !== 'partition');
    grilleContainer.classList.toggle('hidden', view !== 'grille');
    stagePanel.classList.toggle('hidden', view !== 'scene');

    // La note n'a de sens qu'à l'arrêt sur la scène faute de partition : la
    // signaler pendant qu'on lit la grille serait un reproche sans objet.
    const noScore = !available('partition');
    scoreNote.classList.toggle('hidden', !(view === 'scene' && noScore));

    const next = nextView();
    scoreToggle.replaceChildren(iconLabel(NEXT_VIEW_ICONS[next], NEXT_VIEW_LABELS[next]));
    scoreToggle.setAttribute('aria-label', NEXT_VIEW_LABELS[next]);
    viewValue.textContent = VIEW_NAMES[view];
    scoreToggleMobile.setAttribute('aria-label', `Affichage : ${VIEW_NAMES[view]} — ${NEXT_VIEW_LABELS[next]}`);
  }

  // --- Déroulé ---------------------------------------------------------

  function paintStage(): void {
    const composer = order[index]?.composer || 'Compositeur inconnu';
    stagePosition.textContent = `Morceau ${index + 1} sur ${order.length}`;
    stageTitle.textContent = order[index]?.title ?? '';
    stageComposer.textContent = composer;
    identity.title.textContent = order[index]?.title ?? '';
    identity.subtitle.textContent = `· ${composer}`;

    const rest = order.slice(index + 1);
    panelUpNext.replaceChildren(
      ...(rest.length === 0
        ? [el('li', { class: 'text-zinc-500' }, 'Dernier morceau du filage.')]
        : rest.map((song, k) =>
            el(
              'li',
              { class: 'flex items-baseline gap-2' },
              el('span', { class: 'w-5 shrink-0 font-mono text-xs text-zinc-600' }, String(index + 2 + k)),
              el('span', { class: 'truncate' }, song.title),
            ),
          )),
    );

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

  /**
   * Charge la grille du morceau, sans bloquer l'enchaînement : le filage ne
   * doit jamais attendre le réseau. Une grille absente ferme simplement cet
   * état du cycle. Le rendu a besoin d'un `Instrument` pour le nombre de
   * mesures ; à défaut, le premier venu convient, la grille étant écrite en
   * Ut et la même pour toutes les transpositions.
   */
  function loadGrille(song: Song, instrument: Song['instruments'][number] | undefined): void {
    grilleAbort.abort();
    grilleAbort = new AbortController();
    grille = null;
    grilleView.setGrille(null);

    const reference = instrument ?? song.instruments[0];
    if (!reference) return;

    const requested = song.id;
    void (async () => {
      try {
        const response = await fetch(`data/grilles/${song.id}.json`, {
          signal: grilleAbort.signal,
        });
        if (!response.ok) return;
        const data: unknown = await response.json();
        // Le morceau a pu changer pendant la requête : on jette la réponse
        // plutôt que d'afficher la grille du précédent.
        if (!isGrille(data) || order[index]?.id !== requested) return;
        grille = data;
        grilleView.setGrille(data);
        grilleView.render(reference, `${song.id}::grille`, 0);
        paintScoreVisibility();
      } catch {
        /* hors ligne ou requête annulée : la grille reste indisponible */
      }
    })();
  }

  function loadSong(i: number, autoplay: boolean): void {
    index = i;
    const song = order[i]!;
    context.markReached(song.id);
    hasPlayed = false;
    seek.set(0, 0);

    // Le rang reste lisible quand la légende se tronque : il vit dans son
    // propre élément, que la troncature n'atteint pas (#153).
    identity.setCaption([
      'Filage',
      el('span', { class: 'shrink-0' }, ` · ${i + 1} sur ${order.length}`),
    ]);
    paintStage();

    const instrument = song.instruments.find((entry) => entry.id === instrumentId);
    if (instrument) {
      scoreView.render(instrument, `${song.id}::${instrumentId}`, 0);
    } else {
      scoreView.destroy();
      scoreNote.textContent = `Pas de partition en ${INSTRUMENT_SHORT_LABELS[instrumentId]} pour ce morceau.`;
    }
    loadGrille(song, instrument);
    paintScoreVisibility();
    rateStepper.refresh();

    loadAudio(song, autoplay);
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
      { class: 'flex h-dvh flex-col px-4 pb-0 md:px-6' },
      playerMount,

      // Même barre du haut qu'à l'entraînement (#153) : retour, bloc titre,
      // puis la vue et les actions de fin.
      el(
        'header',
        { class: 'dense-bar flex shrink-0 items-center gap-2 py-2 md:gap-3 md:py-4' },
        backButton,
        identity.root,
        scoreToggleMobile,
        scoreToggle,
        el('span', { class: 'h-6 w-px shrink-0 bg-zinc-800 max-md:hidden', 'aria-hidden': 'true' }),
        finishButton,
        nextButton,
      ),

      // Zone principale : la scène, ou la partition.
      el(
        'main',
        { class: 'flex min-h-0 flex-1 flex-col overflow-y-auto pb-4' },
        stagePanel,
        el(
          'div',
          { class: 'mx-auto flex w-full max-w-5xl flex-col gap-4' },
          scoreNote,
          scoreContainer,
          grilleContainer,
        ),
      ),

      // Dock de contrôle : la coquille commune à l'entraînement (`dockShell`,
      // `sheet.ts`), et la même disposition (`createPlayerDock`, #153) : la
      // piste pleine largeur, puis lecture et réglages sous 768 px. Les
      // commandes diffèrent — le filage n'a ni boucle, ni tonalité, ni Défi,
      // mais a « Passer au suivant » et le cycle de vue — dans la barre du
      // haut, à toutes les largeurs (#153).
      dockShell(
        createPlayerDock({
          seek: createSeekRow(seekBar, currentLabel, durationLabel, timeLabel),
          transport: [backSkip, playButton, forwardSkip],
          settings: [
            // Le stepper se replie en pastille « Vitesse » sous 768 px
            // (`rateStepper.compact`, placée après la bande comme à
            // l'entraînement).
            el(
              'div',
              { class: 'flex items-center gap-2 max-md:hidden' },
              el('span', { class: 'text-xs uppercase tracking-wider text-zinc-500' }, 'Vitesse'),
              rateStepper.minus,
              rateStepper.value,
              rateStepper.plus,
            ),
            el('span', { class: 'mx-1 hidden h-6 w-px bg-zinc-700 md:block' }),
            el(
              'span',
              { class: 'text-xs uppercase tracking-wider text-zinc-500 max-md:hidden' },
              'Bande',
            ),
            sourceToggle.root,
            rateStepper.compact,
          ],
        }),
      ),
    ),
    countdownVeil,
    introVeil,
  );

  // La partition du 1er morceau est prête sous le voile ; l'audio ne démarre
  // qu'à la fin du décompte d'entrée (ou dès que l'utilisateur l'écourte).
  loadSong(0, false);
  startIntro();

  unsubscribe = player.onTick((tick) => {
    play.set(tick.playing);
    timeLabel.textContent = `${formatTime(tick.currentTime)} / ${formatTime(tick.duration)}`;
    currentLabel.textContent = formatTime(tick.currentTime);
    durationLabel.textContent = formatTime(tick.duration);
    if (tick.playing) hasPlayed = true;
    seek.set(tick.currentTime, tick.duration);

    const ended =
      hasPlayed &&
      !transitioning &&
      !seek.isScrubbing() &&
      !tick.playing &&
      (player.hasEnded() ||
        (tick.duration > 0 && tick.currentTime >= tick.duration - 0.4));
    if (ended) startCountdown();
  });

  const unsubscribeFailure = player.onFailure((failure) => {
    scoreNote.textContent =
      failure === 'geste'
        ? 'Lecture bloquée par le navigateur — touchez ▶ pour reprendre.'
        : 'Audio indisponible pour ce morceau — enchaînez à la main.';
    scoreNote.classList.remove('hidden');
  });

  void (async () => {
    await player.mount(playerMount);
    // Relance la source du morceau courant maintenant que le lecteur est prêt.
    // Pendant le décompte d'entrée, on se contente de la mettre en file.
    loadAudio(order[index]!, !introActive);
  })();

  return () => {
    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    if (introTimer !== null) window.clearInterval(introTimer);
    window.removeEventListener('keydown', onIntroKey);
    unsubscribe?.();
    unsubscribeFailure();
    player.pause();
    scoreView.destroy();
    grilleAbort.abort();
    grilleView.destroy();
    countdownVeil.remove();
    introVeil.remove();
  };
}
