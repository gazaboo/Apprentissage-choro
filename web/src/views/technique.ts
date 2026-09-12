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
import { Metronome, MAX_BPM, MIN_BPM, clampBpm } from '../metronome';
import { SequencePlayer } from '../player';
import type { Onset } from '../pitch';
import { PitchTracker } from '../pitch';
import { review, statusOf } from '../srs';
import type { Progress } from '../store';
import { getTechniqueCard, putTechniqueCard } from '../store';
import type { ExerciceCarte } from '../technique/catalogue';
import { DEFAULT_BPM, SENS_LABELS, dernierBpm } from '../technique/catalogue';
import { meilleurDecalage, noter, resume } from '../technique/grader';
import { askSrs } from './srsModal';

/** Pas des boutons de tempo — assez large pour se sentir, assez fin pour régler. */
const BPM_STEP = 4;

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
  /** Sur quelle note du motif on a réellement démarré ; voir `meilleurDecalage`. */
  let decalage = 0;

  function carte(): ExerciceCarte {
    return ordre[index] ?? ordre[0]!;
  }

  const metronome = new Metronome({
    onBeat: (beatIndex, audioTime) => {
      beats.push({ index: beatIndex, time: audioTime });
      // Deux battues d'historique suffisent : au-delà, elles sont déjà passées.
      if (beats.length > 8) beats = beats.slice(-8);
      // La prise, elle, garde tout : c'est la matière de la notation finale.
      if (tracker?.listening) prise.beats.push({ index: beatIndex, time: audioTime });
    },
  });

  // --- Nœuds --------------------------------------------------------------

  const progressLabel = el('p', { class: ui.label });
  const accordLabel = el('p', {
    class: 'text-6xl font-semibold tracking-tight text-zinc-100 sm:text-7xl',
  });
  const sensLabel = el('p', { class: 'mt-2 text-sm uppercase tracking-widest text-zinc-500' });
  const statusLabel = el('p', { class: 'text-xs text-zinc-600' });
  const notesRow = el('div', { class: 'flex flex-wrap items-center justify-center gap-2' });
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
  const finishButton = el('button', { type: 'button', class: ui.button }, 'Terminer et évaluer');
  const stopButton = el('button', { type: 'button', class: ui.button }, 'Terminer la séance');
  const backButton = el('button', { type: 'button', class: ui.button }, 'Retour');
  const micButton = el('button', { type: 'button', class: ui.button }, 'Écouter au micro');
  const micHint = el('p', { class: 'text-xs text-zinc-500' });

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
              'inline-flex h-11 min-w-11 items-center justify-center rounded-lg px-3 ' +
              'font-mono text-lg transition ' +
              (active ? 'bg-amber-400/20 text-amber-200' : 'bg-zinc-800/60 text-zinc-400') +
              ring,
          },
          revealed ? name : '•',
        );
      }),
    );
  }

  function paintTempo(): void {
    bpmValue.textContent = String(bpm);
    minus.disabled = bpm <= MIN_BPM;
    plus.disabled = bpm >= MAX_BPM;
    const last = dernierBpm(getTechniqueCard(progress, carte().id));
    bpmHint.textContent =
      last === null ? 'Jamais chronométré.' : `Dernière fois à ${last} BPM.`;
  }

  function paintTransport(): void {
    // Le métronome est l'action première tant qu'il est à l'arrêt ; une fois
    // lancé, il s'efface au profit de « Terminer », qui devient la suite.
    playButton.textContent = metronome.running
      ? 'Arrêter le métronome'
      : 'Démarrer le métronome';
    playButton.className = metronome.running ? ui.buttonActive : ui.primary;
    finishButton.className = metronome.running ? ui.button : ui.primary;
    revealButton.className = revealed ? ui.buttonActive : ui.button;

    // Écoute et métronome partagent le même surlignage : les lancer ensemble
    // brouillerait la pastille allumée, donc l'un exclut l'autre.
    const ecouteEnCours = player?.playing ?? false;
    ecouterButton.textContent = ecouteEnCours ? '❚❚ Arrêter l’écoute' : '▶ Écouter';
    ecouterButton.className = ecouteEnCours ? ui.buttonActive : ui.button;
    ecouterButton.disabled = metronome.running;
    playButton.disabled = ecouteEnCours;
    boucleButton.className = bouclerEcoute ? ui.chipActive : ui.chip;

    const listening = tracker?.listening ?? false;
    micButton.textContent = listening ? 'Couper le micro' : 'Écouter au micro';
    micButton.className = listening ? ui.buttonActive : ui.button;
    micHint.textContent =
      micError ??
      (listening
        ? 'Le relevé est indicatif : sur des notes qui se recouvrent, il se trompe.'
        : 'Facultatif. Sans micro, l’évaluation reste entièrement la vôtre.');
    micHint.classList.toggle('text-rose-300', micError !== null);
    micHint.classList.toggle('text-zinc-500', micError === null);
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

  async function toggleMic(): Promise<void> {
    micError = null;
    if (tracker?.listening) {
      tracker.stop();
      paintTransport();
      return;
    }
    try {
      const context = await metronome.prepare();
      tracker ??= new PitchTracker(context, handleOnset);
      await tracker.start();
      prise = { beats: [], onsets: [] };
    } catch {
      micError = 'Micro indisponible — l’évaluation reste manuelle.';
    }
    paintTransport();
  }

  micButton.addEventListener('click', () => void toggleMic());

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
    stopMetronome();
    stopEcouter();

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

    const answer = await askSrs(
      current.accord,
      `${current.nom} · ${SENS_LABELS[current.sens]}`,
      hints,
      current.notes.length,
      contexte,
    );

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
        sensLabel,
        el('div', { class: 'mt-8 w-full' }, notesRow),
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
        el('div', { class: 'mt-1 flex flex-wrap gap-2' }, playButton, micButton),
        micHint,
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
    // Le micro d'abord : il faut relâcher les pistes de capture avant de
    // fermer le contexte auquel elles sont raccordées.
    tracker?.destroy();
    tracker = null;
    player?.stop();
    player = null;
    metronome.destroy();
  };
}
