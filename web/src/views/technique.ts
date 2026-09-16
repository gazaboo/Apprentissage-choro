/** Séance d'arpèges et de gammes : un chiffrage, un métronome, rien d'autre.
 *
 * L'écran est volontairement nu. Ni portée, ni manche, ni tablature : le
 * chiffrage seul, en grand, et c'est au musicien de retrouver les notes — c'est
 * précisément ce qu'on cherche à acquérir. Les noms de notes existent, mais
 * comme **indice**, sur demande, et l'appui est compté comme il l'est pour la
 * partition à trous : il informe l'auto-évaluation.
 *
 * La rangée de pastilles sous le chiffrage tient le rôle d'une portée minimale.
 * Masquée, elle montre encore où l'on en est dans le motif ; révélée, elle
 * donne les noms. Dans les deux cas, la pastille courante suit l'horloge audio
 * — celle du métronome ou celle du bouton « Écouter », qui rejoue le motif à
 * la bonne hauteur —, non `Date.now()` : le surlignage ne dérive donc jamais
 * du son.
 */

import { el, ui } from '../dom';
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
import { nameFromMidi } from '../technique/theorie';
import { askSrs } from './srsModal';

/** Pas des boutons de tempo — assez large pour se sentir, assez fin pour régler. */
const BPM_STEP = 4;

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

/** Fréquence mesurée, au dixième de hertz, à la française. */
function formatHertz(frequency: number): string {
  return `${frequency.toFixed(1).replace('.', ',')} Hz`;
}

/**
 * Écart au demi-ton tempéré, en centièmes, signe compris.
 *
 * Le signe est ce qui compte : une note juste mais constamment à −20 dit une
 * corde à remonter, là où un nom de note seul laisserait croire à un caprice
 * de la détection.
 */
function formatCents(cents: number): string {
  if (cents === 0) return 'juste';
  return `${cents > 0 ? '+' : '−'}${Math.abs(cents)} ¢`;
}

export interface TechniqueContext {
  progress: Progress;
  /** Les cartes de la séance, dans l'ordre de passage. */
  ordre: ExerciceCarte[];
  /** Consigne un exercice effectivement travaillé, pour le résumé de séance. */
  markWorked: (id: string) => void;
  navigateHome: () => void;
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
  /** `true` entre l'appui sur « Écouter au micro » et la fin (notation auto ou annulation). */
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
  /** Cinq dernières notes entendues pendant le test, la plus récente en tête. */
  let testHeard: Onset[] = [];

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

  const progressLabel = el('p', { class: ui.label });
  const accordLabel = el('p', {
    class: 'text-6xl font-semibold tracking-tight text-zinc-100 sm:text-7xl',
  });
  const sensLabel = el('p', { class: 'mt-2 text-sm uppercase tracking-widest text-zinc-500' });
  // Décompte de préparation : prend temporairement la place du chiffrage,
  // bien visible, pour qu'il soit impossible de manquer le moment où
  // l'évaluation démarre réellement.
  const countdownLabel = el('p', {
    class: 'hidden text-6xl font-semibold tracking-tight text-amber-300 sm:text-7xl',
    'aria-live': 'assertive',
  });
  const statusLabel = el('p', { class: 'text-xs text-zinc-600' });
  // `w-max` + `mx-auto` : centré tant que ça tient, mais un motif trop long
  // (gamme complète, aller-retour) déborde plutôt que de casser sur une
  // ligne orpheline — `flex-wrap` isolait la dernière note sur une ligne à
  // elle seule dès que la rangée dépassait la largeur de l'écran.
  const notesRow = el('div', { class: 'mx-auto flex w-max flex-nowrap items-center gap-2' });
  const workNote = el('p', { class: 'text-sm text-zinc-500 whitespace-pre-line' });

  const bpmValue = el('span', {
    class: 'min-w-[4.5rem] text-center font-mono text-3xl text-amber-300',
  });
  const bpmHint = el('p', { class: 'text-xs text-zinc-500' });

  const minus = el('button', { type: 'button', class: ui.icon, 'aria-label': 'Moins vite' }, '−');
  const plus = el('button', { type: 'button', class: ui.icon, 'aria-label': 'Plus vite' }, '+');
  const playButton = el('button', { type: 'button', class: ui.primary }, 'Démarrer le métronome');
  const revealButton = el('button', { type: 'button', class: ui.button }, 'Voir les notes');
  const ecouterButton = el('button', { type: 'button', class: ui.button }, '▶ Écouter');
  const boucleButton = el('button', { type: 'button', class: ui.chip }, '🔁 Boucle');
  const finishButton = el('button', { type: 'button', class: ui.button }, 'Noter et continuer');
  const stopButton = el('button', { type: 'button', class: ui.button }, 'Terminer la séance');
  const backButton = el('button', { type: 'button', class: ui.button }, 'Retour');
  const micButton = el('button', {
    type: 'button',
    class: ui.button,
    'aria-pressed': 'false',
  }, 'Écouter au micro');
  // `aria-live` : le message d'état change sans que le bouton ne reprenne le
  // focus, il faut donc l'annoncer explicitement aux lecteurs d'écran.
  const micHint = el('p', { class: 'text-xs text-zinc-500', 'aria-live': 'polite' });
  /** Point animé : seul repère qui bouge en continu, preuve que l'écoute est active. */
  const micStatusDot = el('span', { class: 'hidden h-2 w-2 rounded-full bg-amber-400 animate-pulse' });
  const micStatusText = el('span', { class: 'hidden text-xs font-medium text-amber-300' }, 'Écoute en cours…');
  /** VU-mètre minimal : la seule preuve continue que le micro capte du son. */
  const micLevelTrack = el(
    'div',
    { class: 'hidden h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800' },
  );
  const micLevelFill = el('div', {
    class: 'h-full w-0 rounded-full bg-amber-400 transition-[width] duration-75',
  });
  micLevelTrack.append(micLevelFill);

  // Test du micro : hors évaluation, pour lever le doute sur le matériel
  // (micro, distance, bruit ambiant) avant de s'engager dans 3 passes
  // chronométrées — sans quoi un mauvais score reste indécidable entre une
  // erreur de jeu et une détection défaillante.
  const testMicButton = el(
    'button',
    { type: 'button', class: ui.button, 'aria-pressed': 'false' },
    'Tester le micro',
  );
  const testHeardLabel = el('span', {
    class: 'font-mono text-sm text-amber-300',
    'aria-live': 'polite',
  });
  const testHistoryLabel = el('span', {
    class: 'font-mono text-xs text-zinc-500',
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
    { class: 'hidden flex-col gap-2' },
    el('div', { class: 'flex flex-wrap items-center gap-3' }, testHeardLabel, testLevelTrack),
    testHistoryLabel,
    el(
      'p',
      { class: 'text-xs text-zinc-500' },
      'Test libre : rien n’est chronométré ni noté. Jouez quelques notes et vérifiez '
        + 'qu’elles s’affichent à la bonne hauteur et à la bonne octave. L’écart en '
        + 'centièmes dit la justesse : s’il penche toujours du même côté, c’est la '
        + 'guitare qu’il faut accorder, pas la détection qui se trompe.',
    ),
  );

  // --- Peinture -----------------------------------------------------------

  function paintCarte(): void {
    const current = carte();
    progressLabel.textContent = `Technique — exercice ${index + 1} sur ${ordre.length}`;
    accordLabel.textContent = current.accord;
    sensLabel.textContent = `${current.nom} · ${SENS_LABELS[current.sens]}`;
    workNote.textContent = current.noteDeTravail ?? '';
    workNote.classList.toggle('hidden', current.noteDeTravail === null);

    const card = getTechniqueCard(progress, current.id);
    const status = statusOf(card);
    statusLabel.textContent =
      status === 'jamais' ? 'Jamais travaillé' : status === 'a-reviser' ? 'À réviser' : 'À jour';

    paintNotes();
  }

  function paintNotes(): void {
    const current = carte();
    notesRow.replaceChildren(
      ...current.notes.map((name, position) => {
        const active = position === lit;
        const verdict = judged.get(position);
        // L'anneau dit ce que le micro a entendu, le fond dit où l'on en est :
        // les deux informations se superposent sans se cacher l'une l'autre.
        const ring =
          verdict === 'juste'
            ? ' ring-1 ring-emerald-400/60'
            : verdict === 'faux'
              ? ' ring-1 ring-rose-400/60'
              : active
                ? ' ring-1 ring-amber-400/50'
                : '';
        return el(
          'span',
          {
            class:
              'inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-3 ' +
              'font-mono text-lg transition ' +
              (active ? 'bg-amber-400/20 text-amber-200' : 'bg-zinc-800/60 text-zinc-400') +
              ring,
          },
          revealed ? name : '•',
        );
      }),
    );
  }

  /** Bascule entre le chiffrage et le décompte de préparation. `null` le masque. */
  function paintCountdown(remaining: number | null): void {
    const active = remaining !== null;
    countdownLabel.textContent = active ? String(remaining) : '';
    countdownLabel.classList.toggle('hidden', !active);
    accordLabel.classList.toggle('hidden', active);
    sensLabel.classList.toggle('hidden', active);
  }

  function paintTempo(): void {
    bpmValue.textContent = String(bpm);
    minus.disabled = bpm <= MIN_BPM;
    plus.disabled = bpm >= MAX_BPM;
    const last = dernierBpm(getTechniqueCard(progress, carte().id));
    bpmHint.textContent =
      last === null ? 'Jamais chronométré.' : `Dernière fois à ${last} BPM.`;
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
    testMicButton.className = micTesting ? ui.buttonActive : ui.button;
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
    const [dernier] = testHeard;
    testHeardLabel.textContent =
      dernier === undefined
        ? 'Micro : jouez une note…'
        : `Micro : ${nameFromMidi(dernier.midi)} · ${formatHertz(dernier.frequency)}`
          + ` · ${formatCents(dernier.cents)}`;
    // Les précédentes restent affichées : une note isolée ne dit pas si la
    // détection suit, une suite le dit tout de suite.
    testHistoryLabel.textContent =
      testHeard.length > 1
        ? `avant : ${testHeard.slice(1).map((o) => nameFromMidi(o.midi)).join('  ')}`
        : '';
  }

  function paintTransport(): void {
    // Le métronome libre (bouton Play) et l'évaluation (bouton Micro)
    // partagent le même moteur, mais ne doivent jamais sembler tourner tous
    // les deux à la fois : `playRunning` ne reflète que le premier.
    const playRunning = metronome.running && !evaluating;

    // Le métronome est l'action première tant qu'il est à l'arrêt ; une fois
    // lancé, il s'efface au profit de « Terminer », qui devient la suite.
    playButton.textContent = playRunning ? 'Arrêter le métronome' : 'Démarrer le métronome';
    playButton.className = playRunning ? ui.buttonActive : ui.primary;
    revealButton.className = revealed ? ui.buttonActive : ui.button;

    // Écoute et métronome partagent le même surlignage : les lancer ensemble
    // brouillerait la pastille allumée, donc l'un exclut l'autre.
    const ecouteEnCours = player?.playing ?? false;
    ecouterButton.textContent = ecouteEnCours ? '❚❚ Arrêter l’écoute' : '▶ Écouter';
    ecouterButton.className = ecouteEnCours ? ui.buttonActive : ui.button;
    // `evaluating` en plus de `metronome.running` : entre le dernier clic et
    // la notation, le métronome est déjà arrêté (voir `onBeat`) alors que
    // l'évaluation, elle, court toujours.
    ecouterButton.disabled = metronome.running || evaluating || micTesting || micTestActivating;
    playButton.disabled = ecouteEnCours || evaluating || micTesting || micTestActivating;
    boucleButton.className = bouclerEcoute ? ui.chipActive : ui.chip;

    // L'évaluation se note elle-même après ses 3 passes : « Terminer et
    // évaluer » n'a de sens que pour la pratique libre. `style.display`,
    // pas `classList` : `ui.primary`/`ui.button` posent `inline-flex`, qui
    // l'emporterait sur `.hidden` (même spécificité, déclarée après dans le
    // CSS généré par Tailwind).
    finishButton.className = playRunning ? ui.button : ui.primary;
    finishButton.style.display = evaluating ? 'none' : '';

    const listening = tracker?.listening ?? false;
    micButton.textContent = micActivating
      ? 'Activation du micro…'
      : evaluating
        ? 'Annuler l’évaluation'
        : 'Écouter au micro';
    // `ui.buttonActive` n'a pas de style désactivé : le réserver à l'écoute
    // effective garde le bouton visiblement grisé pendant l'activation.
    micButton.className = listening ? ui.buttonActive : ui.button;
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
    if (!listening) micLevelFill.style.width = '0%';

    micHint.textContent =
      micError ??
      (micActivating
        ? 'Autorisez le micro dans le navigateur pour continuer.'
        : evaluating
          ? micSilence
            ? 'Aucun son détecté pour l’instant — jouez près du micro.'
            : 'Notes et rythme sont évalués sur ces 3 passes. Un nouvel appui annule.'
          : playRunning
            ? 'Le métronome libre tourne déjà : arrêtez-le pour lancer l’évaluation.'
            : 'Lance un compteur de 4 temps, puis évalue 3 passes complètes (notes et rythme).');
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
    testHeard = [];
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
          testHeard = [onset, ...testHeard].slice(0, 5);
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
    testHeard = [];
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
  backButton.addEventListener('click', () => context.navigateHome());

  // --- Assemblage ---------------------------------------------------------

  root.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8' },

      el(
        'header',
        { class: 'flex flex-wrap items-center justify-between gap-3' },
        el('div', {}, progressLabel, statusLabel),
        backButton,
      ),

      el(
        'section',
        { class: 'flex flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-10' },
        accordLabel,
        countdownLabel,
        sensLabel,
        el('div', { class: 'mt-8 w-full overflow-x-auto' }, notesRow),
        el(
          'div',
          { class: 'mt-4 flex flex-wrap items-center justify-center gap-2' },
          revealButton,
          ecouterButton,
          boucleButton,
        ),
        el('div', { class: 'mt-6 text-center' }, workNote),
      ),

      el(
        'section',
        { class: `${ui.card} flex flex-col gap-3` },
        el('p', { class: ui.label }, 'Tempo'),
        el(
          'div',
          { class: 'flex items-center gap-3' },
          minus,
          bpmValue,
          plus,
          el('span', { class: 'text-sm text-zinc-500' }, 'BPM'),
        ),
        bpmHint,
        el(
          'div',
          { class: 'mt-1 flex flex-wrap items-center gap-2' },
          playButton,
          micButton,
          testMicButton,
        ),
        el(
          'div',
          { class: 'flex flex-wrap items-center gap-2' },
          micStatusDot,
          micStatusText,
          micLevelTrack,
        ),
        micHint,
        testRow,
      ),

      el('div', { class: 'flex flex-wrap gap-2' }, finishButton, stopButton),
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
