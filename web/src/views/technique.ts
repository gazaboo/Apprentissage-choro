/** Séance d'arpèges et de gammes : un chiffrage, une portée, un métronome.
 *
 * Le chiffrage reste le seul texte affiché en grand, et c'est au musicien de
 * retrouver les notes — c'est précisément ce qu'on cherche à acquérir. La
 * portée, dessous, ne montre d'abord que des **emplacements** : combien de
 * notes, où l'on en est, où tourne le motif (montée et descente d'un
 * aller-retour sont séparées d'un pointillé), et le degré attendu sous chaque
 * note. Les têtes de note elles-mêmes sont un **indice**, sur demande, et
 * l'appui est compté comme il l'est pour la partition à trous : il informe
 * l'auto-évaluation.
 *
 * La note allumée suit l'horloge audio — celle du métronome ou celle du
 * bouton « Écouter », qui rejoue le motif à la bonne hauteur —, non
 * `Date.now()` : le surlignage ne dérive donc jamais du son.
 *
 * Les commandes vivent dans un dock en bas d'écran, comme sur l'écran d'un
 * morceau : tempo, évaluation au micro, métronome, puis « Noter et
 * continuer », seule action en ambre plein.
 */

import { el, setState, ui } from '../dom';
import * as icons from '../icons';
import { Metronome, MAX_BPM, MIN_BPM, clampBpm, cycleOf } from '../metronome';
import { SequencePlayer } from '../player';
import type { Onset } from '../pitch';
import { PitchTracker } from '../pitch';
import { review, statusOf } from '../srs';
import type { Progress } from '../store';
import { getTechniqueCard, putTechniqueCard } from '../store';
import type { ExerciceCarte } from '../technique/catalogue';
import { DEFAULT_BPM, SENS_LABELS, dernierBpm } from '../technique/catalogue';
import { detailLignes, meilleurDecalage, noter, resume } from '../technique/grader';
import { mettreEnPortee, sommet, type MiseEnPortee } from '../technique/portee';
import { chordRoot, degre, nameFromMidi, parseNote } from '../technique/theorie';
import { dessinerPortee } from './portee';
import { askSrs } from './srsModal';

/** Pas des boutons de tempo — un cran par appui, pour un réglage précis. */
const BPM_STEP = 1;

/** Délai d'écoute sans attaque détectée avant d'alerter : le temps de se mettre en place. */
const SILENCE_WARNING_MS = 4000;

/** Battues de préparation avant que l'évaluation déclenchée au micro ne commence réellement. */
const COUNT_IN_BEATS = 4;

/** Passes complètes du motif que le micro exige avant de s'arrêter et de se noter seul. */
const PASSES_REQUISES = 3;

/**
 * Message d'erreur micro à afficher tel quel.
 *
 * Le nom de l'exception distingue le refus de permission — qui appelle un geste
 * précis dans les réglages du navigateur — d'une simple absence de micro, que
 * rien ne peut réparer depuis l'écran.
 */
function messageMicro(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Accès au micro refusé — autorisez-le dans les réglages du navigateur pour ce site.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'Aucun micro détecté sur cet appareil.';
  }
  return 'Micro indisponible — l’évaluation reste manuelle.';
}

export interface TechniqueContext {
  progress: Progress;
  /** Les cartes de la séance, dans l'ordre de passage. */
  ordre: ExerciceCarte[];
  /** Consigne un exercice effectivement travaillé, pour le résumé de séance. */
  markWorked: (id: string) => void;
  /** Retour à la liste des exercices — pas à l'accueil, malgré le nom des autres écrans. */
  navigateBack: () => void;
  onFinish: () => void;
}

export function renderTechnique(root: HTMLElement, context: TechniqueContext): () => void {
  const { progress, ordre } = context;

  // --- État de l'écran ----------------------------------------------------

  let index = 0;
  let hints = 0;
  let revealed = false;
  let bpm = DEFAULT_BPM;
  /** Battues déjà programmées, pour caler le surlignage sur l'horloge audio. */
  let beats: { index: number; time: number }[] = [];
  let frame: number | null = null;
  /** Pastille surlignée, ou `-1` quand rien ne tourne. */
  let lit = -1;

  /** Lecteur du motif au tempo, créé au premier appui sur « Écouter ». */
  let player: SequencePlayer | null = null;
  let bouclerEcoute = false;

  /** Ce que le micro a entendu depuis le démarrage du métronome. */
  let prise: { beats: { index: number; time: number }[]; onsets: Onset[] } = {
    beats: [],
    onsets: [],
  };
  /** Verdict en direct de la passe courante, par position dans le motif. */
  let judged = new Map<number, 'juste' | 'faux'>();
  let tracker: PitchTracker | null = null;
  let micError: string | null = null;
  /** Le temps que `getUserMedia` réponde : sans cet état, le clic semble ignoré. */
  let micActivating = false;
  /** `true` passé quelques secondes d'écoute sans qu'aucune attaque n'ait été détectée. */
  let micSilence = false;
  let silenceTimer: number | null = null;
  /** Sur quelle note du motif on a réellement démarré ; voir `meilleurDecalage`. */
  let decalage = 0;
  /** `true` entre l'appui sur « Évaluation au micro » et la fin (notation auto ou annulation). */
  let evaluating = false;
  /** `true` tant que le décompte de préparation tourne (`onBeat` avec un index négatif). */
  let countingIn = false;
  /** Passe en cours (1 à `PASSES_REQUISES`), affichée pendant l'évaluation. */
  let currentPasse = 1;
  /** Marge laissée après le dernier clic de la dernière passe pour que la note finale soit captée. */
  let graceTimer: number | null = null;

  /**
   * Test du micro : une écoute libre, sans métronome, sans prise et sans
   * notation. Instance de `PitchTracker` distincte de celle de l'évaluation —
   * les callbacks sont fixés au constructeur, et ceux-là affichent au lieu de
   * juger.
   */
  let testTracker: PitchTracker | null = null;
  let micTesting = false;
  let micTestActivating = false;
  /** Incrémenté à chaque coupure du test (`stopMicTest`) : permet à une activation en
   *  cours (`toggleMicTest`) de se découvrir annulée à son réveil et de ne pas passer
   *  `micTesting` à `true` par-dessus une évaluation ou un métronome démarré entre-temps. */
  let micTestGeneration = 0;
  /** Dernière hauteur entendue pendant le test, nommée, ou `null` avant la première. */
  let testHeard: string | null = null;

  function carte(): ExerciceCarte {
    return ordre[index] ?? ordre[0]!;
  }

  const metronome = new Metronome({
    onBeat: (beatIndex, audioTime) => {
      beats.push({ index: beatIndex, time: audioTime });
      // Deux battues d'historique suffisent : au-delà, elles sont déjà passées.
      if (beats.length > 8) beats = beats.slice(-8);

      if (beatIndex < 0) {
        // Décompte de préparation : rien n'est encore joué, seul le repère
        // visuel avance — la prise démarre à zéro battue plus loin.
        // (`countingIn` est déjà passé à `true` par `toggleMic()`, dès le
        // clic : sans ça, le premier repaint arriverait après ce premier
        // `onBeat`, avec un bref retard visible.)
        if (evaluating) paintCountdown(-beatIndex);
        return;
      }
      if (countingIn) {
        // Le compteur vient de s'achever : ardoise vierge, pour qu'un bruit
        // capté pendant la préparation ne fausse pas la première note jugée.
        countingIn = false;
        prise = { beats: [], onsets: [] };
        judged = new Map();
        paintCountdown(null);
        paintTransport();
      }

      // La prise, elle, garde tout : c'est la matière de la notation finale.
      if (tracker?.listening) prise.beats.push({ index: beatIndex, time: audioTime });

      if (evaluating) {
        const motifLength = carte().notes.length;
        const cycle = cycleOf(beatIndex, motifLength);
        if (cycle !== null) {
          const passe = Math.min(cycle + 1, PASSES_REQUISES);
          if (passe !== currentPasse) {
            currentPasse = passe;
            paintTransport();
          }
        }
        if (motifLength > 0 && beatIndex === PASSES_REQUISES * motifLength - 1) {
          // Dernier clic de la dernière passe programmé : on coupe ici la
          // *programmation* des battues suivantes. Sans ça, le métronome
          // continue de tourner pendant le délai de grâce ci-dessous et
          // programme une battue de plus — une 28ᵉ battue fantôme sur un motif
          // de 9 notes en 3 passes, sans note jouée en face, comptée comme une
          // note manquée et gonflant `attendues` de 27 à 28.
          //
          // `metronome.stop()`, la méthode de la classe, et non le
          // `stopMetronome()` local : celui-ci réinitialiserait le surlignage
          // des pastilles avant l'heure. Le clic de cette battue-ci est déjà
          // commis au graphe Web Audio, il sonne donc normalement.
          metronome.stop();

          // On laisse ensuite une battue de marge, mesurée sur l'horloge audio
          // et non sur `Date.now()`, pour que la dernière note ait le temps
          // d'être entendue avant d'arrêter et de noter.
          const delayMs = Math.max(0, (audioTime - metronome.currentTime) * 1000) + (60000 / bpm);
          graceTimer = window.setTimeout(() => {
            graceTimer = null;
            void finish();
          }, delayMs);
        }
      }
    },
  });

  // --- Nœuds --------------------------------------------------------------

  const progressLabel = el('p', {
    class: 'text-xs font-semibold tracking-wide text-zinc-400',
  });
  /** Un segment par exercice : faits, en cours, à venir. */
  const progressBar = el('div', {
    class: 'flex w-32 gap-[3px] md:w-48',
    'aria-hidden': 'true',
  });
  const accordLabel = el('p', {
    class: 'text-7xl font-semibold leading-none tracking-tight text-zinc-100 paysage:text-4xl',
  });
  const sensLabel = el('p', {
    class: 'text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500',
  });
  // Décompte de préparation : prend temporairement la place du chiffrage,
  // bien visible, pour qu'il soit impossible de manquer le moment où
  // l'évaluation démarre réellement.
  const countdownLabel = el('p', {
    class: 'hidden text-7xl font-semibold leading-none tracking-tight text-amber-300 paysage:text-4xl',
    'aria-live': 'assertive',
  });
  const statusLabel = el('p', {
    class:
      'rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold ' +
      'uppercase tracking-wider text-zinc-400',
  });
  /**
   * Hôte de la portée, redessinée à chaque changement (note allumée,
   * verdict, révélation) : neuf notes au plus, le coût est nul. Le SVG y
   * prend une largeur proportionnelle à la longueur du motif, voir
   * `dessinerPortee`.
   */
  const porteeMount = el('div', { class: 'flex w-full justify-center' });
  const workNote = el('p', { class: 'text-center text-sm text-zinc-400 whitespace-pre-line' });

  const bpmValue = el('span', {
    class: 'font-mono text-3xl font-semibold leading-none text-amber-300',
  });
  const bpmHint = el('p', { class: 'text-xs text-zinc-500' });

  const roundStep =
    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ' +
    'border-zinc-700 bg-zinc-800 text-zinc-200 transition hover:border-zinc-500 ' +
    'hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ' +
    'disabled:cursor-not-allowed disabled:opacity-40';
  const minus = el('button', { type: 'button', class: roundStep, 'aria-label': 'Moins vite' }, icons.minus());
  const plus = el('button', { type: 'button', class: roundStep, 'aria-label': 'Plus vite' }, icons.plus());

  /**
   * Bouton rond du dock, légendé dessous : le cercle porte l'icône, la
   * légende dit l'action en un mot. Le bouton entier est la cible, légende
   * comprise ; son nom accessible est l'`aria-label`, plus précis.
   */
  function dockButton(size: string): {
    root: HTMLButtonElement;
    disc: HTMLSpanElement;
    caption: HTMLSpanElement;
  } {
    const disc = el('span', {
      class: `inline-flex ${size} items-center justify-center rounded-full border transition`,
    });
    const caption = el('span', { class: 'text-[11px] font-medium leading-none' });
    const root = el(
      'button',
      {
        type: 'button',
        class:
          'group flex shrink-0 flex-col items-center gap-1.5 rounded-xl p-0.5 focus:outline-none ' +
          'focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed ' +
          'disabled:opacity-40',
      },
      disc,
      caption,
    );
    return { root, disc, caption };
  }

  const play = dockButton('h-14 w-14');
  const playButton = play.root;
  const mic = dockButton('h-12 w-12');
  const micButton = mic.root;
  micButton.setAttribute('aria-pressed', 'false');

  /** Pastille des bascules de l'exercice (voir les notes, écouter, boucle). */
  const pill = (on: boolean, live: boolean, shape: string): string =>
    'inline-flex min-h-11 items-center justify-center gap-2 border text-sm font-medium ' +
    'transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ' +
    'disabled:cursor-not-allowed disabled:opacity-40 ' +
    shape +
    ' ' +
    (on && live
      ? 'border-amber-400/50 bg-amber-400/15 text-amber-200'
      : on
        ? `bg-transparent ${ui.selected}`
        : 'border-zinc-800 bg-transparent text-zinc-300 hover:border-zinc-600 hover:bg-zinc-900');

  const revealButton = el(
    'button',
    { type: 'button', 'aria-pressed': 'false' },
    icons.eye(),
    el('span', {}, 'Voir les notes'),
  );
  const ecouterLabel = el('span', {}, 'Écouter');
  const ecouterIcon = el('span', { class: 'inline-flex' }, icons.volume());
  const ecouterButton = el('button', { type: 'button' }, ecouterIcon, ecouterLabel);
  const boucleButton = el(
    'button',
    { type: 'button', 'aria-label': 'Boucle', 'aria-pressed': 'false' },
    icons.repeat(),
  );

  const finishButton = el('button', { type: 'button', class: ui.primary }, 'Noter et continuer');
  const textButton =
    'inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-zinc-300 ' +
    'transition hover:bg-zinc-900 hover:text-white focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-amber-400';
  const stopButton = el(
    'button',
    { type: 'button', class: textButton },
    'Terminer',
    el('span', { class: 'max-md:hidden' }, ' la séance'),
  );
  const backButton = el(
    'button',
    { type: 'button', class: `${textButton} min-w-11 justify-center md:pr-3` },
    icons.chevronLeft(),
    el('span', { class: 'max-md:sr-only' }, 'Retour'),
  );
  // `aria-live` : le message d'état change sans que le bouton ne reprenne le
  // focus, il faut donc l'annoncer explicitement aux lecteurs d'écran.
  const micHint = el('p', { class: 'text-center text-xs text-zinc-500', 'aria-live': 'polite' });
  /** Point animé : seul repère qui bouge en continu, preuve que l'écoute est active. */
  const micStatusDot = el('span', { class: 'hidden h-2 w-2 rounded-full bg-rose-400 animate-pulse' });
  const micStatusText = el('span', { class: 'hidden text-xs font-semibold text-rose-300' }, 'Écoute en cours…');
  /** VU-mètre minimal : la seule preuve continue que le micro capte du son. */
  const micLevelTrack = el(
    'div',
    { class: 'hidden h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800' },
  );
  const micLevelFill = el('div', {
    class: 'h-full w-0 rounded-full bg-amber-400 transition-[width] duration-75',
  });
  micLevelTrack.append(micLevelFill);
  const micStatusRow = el(
    'div',
    { class: 'hidden flex-wrap items-center justify-center gap-2' },
    micStatusDot,
    micStatusText,
    micLevelTrack,
  );

  // Test du micro : hors évaluation, pour lever le doute sur le matériel
  // (micro, distance, bruit ambiant) avant de s'engager dans 3 passes
  // chronométrées — sans quoi un mauvais score reste indécidable entre une
  // erreur de jeu et une détection défaillante. Un simple lien du dock : on
  // s'en sert une fois, pas à chaque exercice.
  const testMicButton = el(
    'button',
    {
      type: 'button',
      class:
        'min-h-11 rounded text-xs text-zinc-400 max-md:-my-3 underline decoration-dotted underline-offset-4 ' +
        'transition hover:text-zinc-200 focus:outline-none focus-visible:ring-2 ' +
        'focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-40',
      'aria-pressed': 'false',
    },
    'Tester le micro',
  );
  const testHeardLabel = el('span', {
    class: 'font-mono text-sm text-amber-300',
    'aria-live': 'polite',
  });
  const testLevelTrack = el('div', {
    class: 'h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800',
  });
  const testLevelFill = el('div', {
    class: 'h-full w-0 rounded-full bg-emerald-400 transition-[width] duration-75',
  });
  testLevelTrack.append(testLevelFill);
  const testRow = el(
    'div',
    { class: 'hidden flex-col items-center gap-2', 'data-releve-micro': '' },
    el('div', { class: 'flex flex-wrap items-center justify-center gap-3' }, testHeardLabel, testLevelTrack),
    el(
      'p',
      { class: 'max-w-sm text-center text-xs text-zinc-500' },
      'Test libre : rien n’est chronométré ni noté. Jouez quelques notes et vérifiez '
        + 'qu’elles s’affichent à la bonne hauteur et à la bonne octave.',
    ),
  );

  // --- Peinture -----------------------------------------------------------

  /** Mise en page de la carte courante et degrés de ses notes, recalculés à chaque carte. */
  let mise: MiseEnPortee = mettreEnPortee([], []);
  let degres: string[] = [];

  function paintCarte(): void {
    const current = carte();
    progressLabel.textContent = `Exercice ${index + 1} sur ${ordre.length}`;
    progressBar.replaceChildren(
      ...ordre.map((_, position) =>
        el('span', {
          class:
            'h-1 flex-1 rounded-full ' +
            (position < index ? 'bg-amber-400' : position === index ? 'bg-amber-300/60' : 'bg-zinc-800'),
        }),
      ),
    );
    accordLabel.textContent = current.accord;
    sensLabel.textContent = `${current.nom} · ${SENS_LABELS[current.sens]}`;
    workNote.textContent = current.noteDeTravail ?? '';
    workNote.classList.toggle('hidden', current.noteDeTravail === null);

    const card = getTechniqueCard(progress, current.id);
    const status = statusOf(card);
    statusLabel.textContent =
      status === 'jamais' ? 'Jamais travaillé' : status === 'a-reviser' ? 'À réviser' : 'À jour';

    mise = mettreEnPortee(current.notes, current.midi, sommet(current.midi, current.sens));
    const root = chordRoot(current.accord);
    degres = current.notes.map((name) => {
      const note = parseNote(name);
      return note && root ? degre(note, root) : '';
    });

    paintNotes();
  }

  function paintNotes(): void {
    porteeMount.replaceChildren(
      dessinerPortee(mise, { revelee: revealed, active: lit, verdicts: judged, degres }),
    );
  }

  /** Bascule entre le chiffrage et le décompte de préparation. `null` le masque. */
  function paintCountdown(remaining: number | null): void {
    const active = remaining !== null;
    countdownLabel.textContent = active ? String(remaining) : '';
    countdownLabel.classList.toggle('hidden', !active);
    accordLabel.classList.toggle('hidden', active);
    sensLabel.classList.toggle('invisible', active);
  }

  function paintTempo(): void {
    bpmValue.textContent = String(bpm);
    minus.disabled = bpm <= MIN_BPM;
    plus.disabled = bpm >= MAX_BPM;
    const last = dernierBpm(getTechniqueCard(progress, carte().id));
    bpmHint.textContent =
      last === null ? 'Jamais chronométré' : `Dernière fois à ${last} BPM`;
  }

  /**
   * Le test du micro a sa propre peinture : son callback `onOnset` la rappelle
   * à chaque note entendue, bien plus souvent que le reste du transport.
   */
  function paintMicTest(): void {
    testMicButton.textContent = micTestActivating
      ? 'Activation du micro…'
      : micTesting
        ? 'Arrêter le test'
        : 'Tester le micro';
    setState(testMicButton, micTesting);
    // Même micro physique, même règle d'exclusion que Play/Micro depuis #49 :
    // on ne teste pas pendant qu'une écoute ou une lecture tourne.
    testMicButton.disabled =
      micTestActivating ||
      micActivating ||
      metronome.running ||
      evaluating ||
      (player?.playing ?? false);
    testMicButton.setAttribute('aria-pressed', String(micTesting));

    testRow.classList.toggle('hidden', !micTesting);
    testRow.classList.toggle('flex', micTesting);
    testHeardLabel.textContent =
      testHeard === null ? 'Micro : jouez une note…' : `Micro : ${testHeard}`;
  }

  function paintTransport(): void {
    // Le métronome libre (bouton Play) et l'évaluation (bouton Micro)
    // partagent le même moteur, mais ne doivent jamais sembler tourner tous
    // les deux à la fois : `playRunning` ne reflète que le premier.
    const playRunning = metronome.running && !evaluating;

    // Ambre vivant quand il tourne (#137) ; au repos, une icône ambre sur
    // fond neutre, pour laisser l'ambre plein à « Noter et continuer ».
    play.disc.replaceChildren(playRunning ? icons.pause() : icons.play());
    play.disc.className =
      'inline-flex h-14 w-14 items-center justify-center rounded-full border transition ' +
      (playRunning
        ? 'border-amber-400 bg-amber-400 text-zinc-950 shadow-lg shadow-amber-400/20'
        : 'border-amber-400/45 bg-zinc-800 text-amber-400 group-hover:bg-zinc-700');
    play.caption.textContent = 'Métronome';
    play.caption.className =
      'text-[11px] font-medium leading-none ' + (playRunning ? 'text-amber-300' : 'text-zinc-400');
    playButton.setAttribute('aria-label', playRunning ? 'Arrêter le métronome' : 'Démarrer le métronome');
    setState(playButton, playRunning);

    revealButton.className = pill(revealed, false, 'rounded-full px-4');
    setState(revealButton, revealed);
    revealButton.setAttribute('aria-pressed', String(revealed));

    // Écoute et métronome partagent le même surlignage : les lancer ensemble
    // brouillerait la note allumée, donc l'un exclut l'autre.
    const ecouteEnCours = player?.playing ?? false;
    ecouterLabel.textContent = ecouteEnCours ? 'Arrêter l’écoute' : 'Écouter';
    ecouterIcon.replaceChildren(ecouteEnCours ? icons.pause() : icons.volume());
    ecouterButton.className = pill(ecouteEnCours, true, 'rounded-l-full border-r-0 pl-4 pr-3');
    setState(ecouterButton, ecouteEnCours);
    // `evaluating` en plus de `metronome.running` : entre le dernier clic et
    // la notation, le métronome est déjà arrêté (voir `onBeat`) alors que
    // l'évaluation, elle, court toujours.
    ecouterButton.disabled = metronome.running || evaluating || micTesting || micTestActivating;
    playButton.disabled = ecouteEnCours || evaluating || micTesting || micTestActivating;
    boucleButton.className = pill(bouclerEcoute, true, 'w-12 rounded-r-full');
    setState(boucleButton, bouclerEcoute);
    boucleButton.setAttribute('aria-pressed', String(bouclerEcoute));

    // L'évaluation se note elle-même après ses 3 passes : « Noter et
    // continuer » n'a de sens que pour la pratique libre. `style.display`,
    // pas `classList` : `ui.primary`/`ui.button` posent `inline-flex`, qui
    // l'emporterait sur `.hidden` (même spécificité, déclarée après dans le
    // CSS généré par Tailwind).
    finishButton.className =
      `${playRunning ? ui.button : ui.primary} min-h-12 w-full [grid-area:suite] md:w-auto md:px-8 paysage:w-auto paysage:px-6`;
    finishButton.style.display = evaluating ? 'none' : '';

    const listening = tracker?.listening ?? false;
    mic.disc.replaceChildren(evaluating ? icons.x() : icons.mic());
    mic.disc.className =
      'inline-flex h-12 w-12 items-center justify-center rounded-full border transition ' +
      (evaluating
        ? 'border-rose-400/50 bg-rose-400/15 text-rose-300'
        : 'border-zinc-700 bg-zinc-800 text-zinc-100 group-hover:bg-zinc-700');
    mic.caption.textContent = micActivating ? 'Activation…' : evaluating ? 'Annuler' : 'Évaluer';
    mic.caption.className =
      'text-[11px] font-medium leading-none ' + (evaluating ? 'text-rose-300' : 'text-zinc-400');
    micButton.setAttribute(
      'aria-label',
      micActivating ? 'Activation du micro…' : evaluating ? 'Annuler l’évaluation' : 'Évaluation au micro',
    );
    setState(micButton, listening);
    // Le métronome libre tourne déjà : le micro attend qu'il s'arrête plutôt
    // que de faire démarrer un second métronome par-dessus.
    micButton.disabled =
      micActivating || micTesting || micTestActivating || (metronome.running && !evaluating);
    micButton.setAttribute('aria-pressed', String(listening));

    paintMicTest();

    micStatusDot.classList.toggle('hidden', !listening);
    micStatusText.classList.toggle('hidden', !listening);
    micStatusText.textContent = countingIn
      ? 'Préparez-vous…'
      : evaluating
        ? `Passe ${currentPasse} / ${PASSES_REQUISES}`
        : 'Écoute en cours…';
    micLevelTrack.classList.toggle('hidden', !listening);
    micStatusRow.classList.toggle('hidden', !listening);
    micStatusRow.classList.toggle('flex', listening);
    if (!listening) micLevelFill.style.width = '0%';

    // L'explication de l'évaluation vit dans l'infobulle du bouton : l'écran
    // ne parle que quand il y a quelque chose à dire.
    const explication =
      'Lance un compteur de 4 temps, puis évalue 3 passes complètes (notes et rythme).';
    micButton.title = explication;
    const message =
      micError ??
      (micActivating
        ? 'Autorisez le micro dans le navigateur pour continuer.'
        : evaluating
          ? micSilence
            ? 'Aucun son détecté pour l’instant — jouez près du micro.'
            : 'Notes et rythme sont évalués sur ces 3 passes. Un nouvel appui annule.'
          : playRunning
            ? 'Le métronome libre tourne déjà : arrêtez-le pour lancer l’évaluation.'
            : null);
    micHint.textContent = message ?? '';
    micHint.classList.toggle('hidden', message === null);
    micHint.classList.toggle('text-rose-300', micError !== null || micSilence);
    micHint.classList.toggle('text-zinc-500', micError === null && !micSilence);
  }
  // --- Tempo et métronome -------------------------------------------------

  function setBpm(next: number): void {
    const clamped = clampBpm(next);
    if (clamped === bpm) return;
    bpm = clamped;
    metronome.setBpm(bpm);
    paintTempo();
  }

  minus.addEventListener('click', () => setBpm(bpm - BPM_STEP));
  plus.addEventListener('click', () => setBpm(bpm + BPM_STEP));

  async function toggleMetronome(): Promise<void> {
    if (metronome.running) {
      stopMetronome();
      return;
    }
    // Le test partage le micro et l'attention : démarrer le métronome le clôt.
    stopMicTest();
    beats = [];
    prise = { beats: [], onsets: [] };
    judged = new Map();
    // L'accent tombe sur la première note du motif : on entend le cycle, ce
    // qui suffit à se repérer sans compter.
    await metronome.start(bpm, carte().notes.length);
    startFrames();
    paintTransport();
  }

  function stopMetronome(): void {
    metronome.stop();
    stopFrames();
    lit = -1;
    paintNotes();
    paintTransport();
  }

  playButton.addEventListener('click', () => void toggleMetronome());

  /**
   * Joue le motif affiché, une note à la fois, à la hauteur et au tempo
   * exacts de la carte. Le lecteur partage l'horloge audio du métronome —
   * `metronome.prepare()` — pour que le surlignage des pastilles se cale
   * dessus sans code séparé : `tick()` lit déjà `metronome.currentTime`.
   */
  async function toggleEcouter(): Promise<void> {
    if (player?.playing) {
      stopEcouter();
      return;
    }
    beats = [];
    const context = await metronome.prepare();
    player ??= new SequencePlayer(context, {
      onNote: (position, time) => {
        beats.push({ index: position, time });
        if (beats.length > 8) beats = beats.slice(-8);
      },
      onDone: stopEcouter,
    });
    await player.start(carte().midi, bpm, bouclerEcoute);
    startFrames();
    paintTransport();
  }

  function stopEcouter(): void {
    player?.stop();
    stopFrames();
    lit = -1;
    paintNotes();
    paintTransport();
  }

  ecouterButton.addEventListener('click', () => void toggleEcouter());
  boucleButton.addEventListener('click', () => {
    bouclerEcoute = !bouclerEcoute;
    // Une lecture déjà démarrée avec « Écouter » a capturé l'ancienne valeur
    // au lancement ; sans ce réglage à chaud, activer Boucle en cours de
    // route n'aurait d'effet qu'à la prochaine pression sur « Écouter ».
    player?.setLoop(bouclerEcoute);
    paintTransport();
  });

  /**
   * Le surlignage se déduit de l'horloge audio à chaque image : la battue
   * courante est la dernière dont l'instant est déjà passé. Repeindre depuis
   * `onBeat` avancerait le surlignage de la portée de programmation, soit un
   * dixième de seconde d'avance visible sur le clic.
   */
  function tick(): void {
    const now = metronome.currentTime;
    let current = -1;
    for (const beat of beats) {
      if (beat.time <= now) current = beat.index;
    }
    const next = current < 0 ? -1 : current % carte().notes.length;
    if (next !== lit) {
      // Chaque passe repart d'une ardoise vierge : le retour en direct montre
      // la passe en cours, pas l'accumulation depuis le début.
      if (next === 0) judged = new Map();
      lit = next;
      paintNotes();
    }
    frame = window.requestAnimationFrame(tick);
  }

  function startFrames(): void {
    if (frame === null) frame = window.requestAnimationFrame(tick);
  }

  function stopFrames(): void {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
  }

  // --- Micro --------------------------------------------------------------

  /**
   * Retour en direct : on rattache l'attaque à la battue la plus proche plutôt
   * qu'à la pastille allumée, car une note jouée un peu en avance appartient
   * déjà à la battue suivante.
   */
  function handleOnset(onset: Onset): void {
    if (silenceTimer !== null) {
      window.clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (micSilence) {
      micSilence = false;
      paintTransport();
    }
    prise.onsets.push(onset);

    const motif = carte().midi;
    // Une fois par passe : assez souvent pour se recaler vite, assez rare pour
    // que la recherche de décalage ne pèse pas sur chaque note.
    if (motif.length > 0 && prise.onsets.length % motif.length === 0) {
      decalage = meilleurDecalage(motif, prise.beats, prise.onsets);
    }

    let closest: { index: number; time: number } | null = null;
    for (const beat of prise.beats) {
      if (!closest || Math.abs(beat.time - onset.audioTime) < Math.abs(closest.time - onset.audioTime)) {
        closest = beat;
      }
    }
    if (!closest) return;

    const position = closest.index % motif.length;
    const attendu = motif[(closest.index + decalage) % motif.length];
    if (attendu === undefined) return;

    judged.set(position, onset.midi === attendu ? 'juste' : 'faux');
    paintNotes();
  }

  function handleLevel(level: number): void {
    micLevelFill.style.width = `${Math.round(level * 100)}%`;
  }

  function clearSilenceTimer(): void {
    if (silenceTimer !== null) window.clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  /** Annule l'évaluation en cours (compteur ou passes) sans la noter. */
  function cancelEvaluation(): void {
    if (graceTimer !== null) {
      window.clearTimeout(graceTimer);
      graceTimer = null;
    }
    tracker?.stop();
    clearSilenceTimer();
    micSilence = false;
    evaluating = false;
    countingIn = false;
    currentPasse = 1;
    paintCountdown(null);
    stopMetronome();
  }

  async function toggleMic(): Promise<void> {
    // Sans cette garde, un clic pendant l'attente de `getUserMedia` relancerait
    // une seconde demande d'accès au micro au lieu d'être ignoré.
    if (micActivating) return;
    micError = null;
    if (tracker?.listening) {
      cancelEvaluation();
      return;
    }
    stopMicTest();
    micActivating = true;
    paintTransport();
    try {
      const context = await metronome.prepare();
      tracker ??= new PitchTracker(context, handleOnset, handleLevel);
      await tracker.start();
      prise = { beats: [], onsets: [] };
      judged = new Map();
      decalage = 0;
      micSilence = false;
      clearSilenceTimer();
      evaluating = true;
      countingIn = true;
      currentPasse = 1;
      // Le micro déclenche désormais lui-même son métronome, synchronisé sur
      // un compteur de préparation : c'est le seul point d'entrée d'une
      // évaluation complète (voir issue #49).
      await metronome.start(bpm, carte().notes.length, COUNT_IN_BEATS);
      startFrames();
      silenceTimer = window.setTimeout(() => {
        silenceTimer = null;
        micSilence = true;
        paintTransport();
      }, SILENCE_WARNING_MS);
    } catch (error) {
      micError = messageMicro(error);
      evaluating = false;
    }
    micActivating = false;
    paintTransport();
  }

  micButton.addEventListener('click', () => void toggleMic());

  /**
   * Écoute libre, pour vérifier que le micro et la détection de hauteur
   * fonctionnent sur ce matériel avant de s'engager dans une évaluation
   * chronométrée : ni métronome, ni prise, ni notation — juste la note
   * entendue et un niveau d'entrée.
   */
  async function toggleMicTest(): Promise<void> {
    if (micTestActivating) return;
    if (micTesting) {
      stopMicTest();
      return;
    }
    micError = null;
    micTestActivating = true;
    testHeard = null;
    paintTransport();
    // Capturé avant les `await` : si `stopMicTest()` est appelé entre-temps (par
    // exemple parce que le micro ou le métronome a démarré ailleurs pendant que le
    // navigateur demandait la permission), la génération aura changé à notre réveil.
    const generation = micTestGeneration;
    try {
      // Même `AudioContext` que le métronome, comme pour l'évaluation : un
      // second contexte n'apporterait rien et coûterait un périphérique de
      // plus à ouvrir.
      const context = await metronome.prepare();
      testTracker ??= new PitchTracker(
        context,
        (onset) => {
          testHeard = nameFromMidi(onset.midi);
          paintMicTest();
        },
        (level) => {
          testLevelFill.style.width = `${Math.round(level * 100)}%`;
        },
      );
      await testTracker.start();
      if (generation !== micTestGeneration) {
        // Annulé pendant l'activation : ne pas ressusciter le test par-dessus
        // ce qui a démarré entre-temps.
        testTracker.stop();
      } else {
        micTesting = true;
      }
    } catch (error) {
      micError = messageMicro(error);
    }
    micTestActivating = false;
    paintTransport();
  }

  function stopMicTest(): void {
    // Compte même si le test n'a pas encore fini de s'activer : c'est ce qui permet
    // à `toggleMicTest()` de se découvrir annulé à son réveil, voir plus haut.
    micTestGeneration++;
    if (!micTesting) return;
    testTracker?.stop();
    micTesting = false;
    testHeard = null;
    testLevelFill.style.width = '0%';
    paintTransport();
  }

  testMicButton.addEventListener('click', () => void toggleMicTest());

  // --- Indice -------------------------------------------------------------

  revealButton.addEventListener('click', () => {
    // Chaque appui compte, y compris pour remasquer : ce qu'on mesure est le
    // nombre de fois où l'on a eu besoin de regarder.
    if (!revealed) hints += 1;
    revealed = !revealed;
    paintNotes();
    paintTransport();
  });

  // --- Évaluation ---------------------------------------------------------

  async function finish(endSession = false): Promise<void> {
    const current = carte();
    // Appelé aussi bien depuis la fin automatique des 3 passes (le micro
    // écoute encore) que depuis « Terminer la séance » en pleine évaluation :
    // dans les deux cas, le micro doit se taire avant la notation.
    if (graceTimer !== null) {
      window.clearTimeout(graceTimer);
      graceTimer = null;
    }
    if (evaluating) {
      tracker?.stop();
      evaluating = false;
      countingIn = false;
      currentPasse = 1;
      paintCountdown(null);
    }
    stopMetronome();
    stopEcouter();
    stopMicTest();
    // Le minuteur d'alerte silence, armé par toggleMic(), continuerait sinon
    // à courir et pourrait se déclencher sur l'exercice suivant.
    clearSilenceTimer();

    // Une hauteur attendue par battue relevée : le motif se répète tant que le
    // métronome tourne, et l'on note tout ce qui a été joué. Le décalage est
    // recalculé une dernière fois sur la prise entière.
    if (current.midi.length > 0 && prise.onsets.length > 0) {
      decalage = meilleurDecalage(current.midi, prise.beats, prise.onsets);
    }
    const attendues = prise.beats.map(
      (beat) => current.midi[(beat.index + decalage) % current.midi.length] ?? 0,
    );
    const resultat = noter(
      attendues,
      prise.beats.map((beat) => beat.time),
      prise.onsets,
    );
    const mesure =
      resultat.attendues > 0
        ? {
            justesse: resultat.justes / resultat.attendues,
            placement: resultat.dansLaFenetre / resultat.attendues,
          }
        : {};

    const contexte =
      resultat.attendues > 0
        ? resume(resultat, bpm)
        : `Travaillé à ${bpm} BPM. ${
            hints === 0 ? 'Les notes n’ont pas été révélées.' : `Notes révélées ${hints} fois.`
          }`;

    // Le relevé note à note : ce que le résumé chiffré ne dit pas. Seulement
    // s'il y a quelque chose à montrer — un passage sans accroc n'a pas de
    // lignes, et une modale vide ferait douter du relevé plutôt que l'éclairer.
    const lignes = detailLignes(resultat, prise.beats, current.midi.length);
    const detail =
      lignes.length > 0
        ? el('div', {}, ...lignes.map((ligne) => el('p', {}, ligne)))
        : undefined;

    const answer = await askSrs(
      current.accord,
      `${current.nom} · ${SENS_LABELS[current.sens]}`,
      hints,
      current.notes.length,
      contexte,
      detail,
    );

    // Annulation : ni note, ni passage à l'exercice suivant — on reprend celui-ci.
    if (answer === 'cancelled') {
      paintNotes();
      paintTransport();
      return;
    }
    if (answer) {
      const card = review(
        getTechniqueCard(progress, current.id),
        answer.grade,
        answer.tempo,
        answer.hints,
        { bpm, ...mesure },
      );
      putTechniqueCard(progress, current.id, card);
      context.markWorked(current.id);
    }

    hints = 0;
    revealed = false;
    prise = { beats: [], onsets: [] };
    judged = new Map();
    decalage = 0;

    if (endSession || index + 1 >= ordre.length) {
      context.onFinish();
      return;
    }

    index += 1;
    // Le tempo suit la carte suivante : chacune a le sien.
    bpm = dernierBpm(getTechniqueCard(progress, carte().id)) ?? DEFAULT_BPM;
    paintCarte();
    paintTempo();
    paintTransport();
  }

  finishButton.addEventListener('click', () => void finish());
  stopButton.addEventListener('click', () => void finish(true));
  backButton.addEventListener('click', () => context.navigateBack());

  // --- Assemblage ---------------------------------------------------------
  //
  // Coquille à trois bandes, comme l'écran d'entraînement : barre du haut,
  // exercice au milieu (qui défile seul si l'écran est trop court), dock de
  // transport en bas. Le dock ne recouvre donc jamais la portée.

  const dock = el(
    'div',
    {
      class:
        'shrink-0 rounded-t-3xl border-t border-zinc-800 bg-zinc-900/80 px-4 pt-3 ' +
        'pb-[calc(env(safe-area-inset-bottom)+1rem)] md:rounded-none md:px-8 md:py-4 ' +
        'paysage:rounded-none paysage:pt-2 paysage:pb-[calc(env(safe-area-inset-bottom)+0.5rem)]',
    },
    el(
      'div',
      {
        // Mobile : l'info sur toute la largeur, puis tempo | transport, puis
        // « Noter et continuer ». Au-delà de 768 px, une seule ligne — de même
        // sur un téléphone en paysage, où les trois lignes laissaient à peine
        // 120 px à la portée (#170).
        class:
          'mx-auto grid max-w-5xl grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 ' +
          "[grid-template-areas:'info_info'_'tempo_transport'_'suite_suite'] " +
          'md:grid-cols-[auto_1fr_auto_auto] md:gap-x-6 ' +
          "md:[grid-template-areas:'tempo_info_transport_suite'] " +
          'paysage:grid-cols-[auto_1fr_auto_auto] ' +
          "paysage:[grid-template-areas:'tempo_info_transport_suite']",
      },
      el(
        'div',
        {
          class:
            'flex items-center justify-between gap-3 [grid-area:info] ' +
            'md:flex-col md:items-start md:justify-center md:gap-0 ' +
            'paysage:flex-col paysage:items-start paysage:justify-center paysage:gap-0',
        },
        bpmHint,
        testMicButton,
      ),
      el(
        'div',
        { class: 'flex items-center gap-1 [grid-area:tempo]' },
        minus,
        el(
          'div',
          { class: 'flex min-w-[4.5rem] flex-col items-center gap-1' },
          bpmValue,
          el('span', { class: 'text-[10px] font-semibold tracking-[0.12em] text-zinc-500' }, 'BPM'),
        ),
        plus,
      ),
      el(
        'div',
        { class: 'flex items-end gap-4 [grid-area:transport]' },
        micButton,
        playButton,
      ),
      finishButton,
    ),
  );

  root.replaceChildren(
    el(
      'div',
      { class: 'flex h-dvh flex-col bg-zinc-950' },

      el(
        'header',
        {
          class:
            'grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 py-2 ' +
            '[padding-top:calc(env(safe-area-inset-top)+0.5rem)] md:px-6 md:py-4 ' +
            'paysage:py-0.5 paysage:[padding-top:calc(env(safe-area-inset-top)+0.125rem)]',
        },
        el('div', { class: 'justify-self-start' }, backButton),
        el(
          'div',
          { class: 'flex flex-col items-center gap-1.5' },
          progressLabel,
          progressBar,
        ),
        el('div', { class: 'justify-self-end' }, stopButton),
      ),

      el(
        'main',
        { class: 'min-h-0 flex-1 overflow-y-auto' },
        el(
          'div',
          {
            class:
              // Aligné en haut, pas centré : les messages du micro apparaissent
              // et disparaissent sous les boutons, et un contenu centré ferait
              // alors glisser la portée pendant qu'on la lit.
              'mx-auto flex max-w-3xl flex-col items-center gap-5 px-4 pb-4 ' +
              'pt-[max(1rem,4vh)] md:gap-6 md:pb-6 paysage:gap-3 paysage:pt-2',
          },
          el(
            'div',
            {
              // En paysage (#170), l'en-tête de l'exercice tient sur une ligne :
              // la portée doit rester visible sans défiler.
              class:
                'flex flex-col items-center gap-3 text-center ' +
                'paysage:flex-row paysage:flex-wrap paysage:justify-center paysage:gap-x-4 paysage:gap-y-1',
            },
            sensLabel,
            accordLabel,
            countdownLabel,
            statusLabel,
          ),
          el(
            'section',
            {
              class:
                'w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 px-1 py-4 ' +
                'sm:px-4 md:px-8 md:py-5 paysage:py-2',
              'aria-label': 'Motif',
            },
            porteeMount,
          ),
          workNote,
          el(
            'div',
            { class: 'flex flex-wrap items-center justify-center gap-2' },
            revealButton,
            el('div', { class: 'flex' }, ecouterButton, boucleButton),
          ),
          micStatusRow,
          micHint,
          testRow,
        ),
      ),

      dock,
    ),
  );
  bpm = dernierBpm(getTechniqueCard(progress, carte().id)) ?? DEFAULT_BPM;
  paintCarte();
  paintTempo();
  paintTransport();

  // --- Démontage ----------------------------------------------------------

  return () => {
    stopFrames();
    clearSilenceTimer();
    if (graceTimer !== null) window.clearTimeout(graceTimer);
    // Le micro d'abord : il faut relâcher les pistes de capture avant de
    // fermer le contexte auquel elles sont raccordées.
    tracker?.destroy();
    tracker = null;
    testTracker?.destroy();
    testTracker = null;
    player?.stop();
    player = null;
    metronome.destroy();
  };
}
