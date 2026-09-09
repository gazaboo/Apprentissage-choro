/** Notes, transposition et hauteurs, pour le travail des arpèges et gammes.
 *
 * Un motif est écrit une seule fois dans le catalogue, dans une tonalité de
 * référence, puis transposé dans les autres. La difficulté n'est pas le
 * décalage — c'est l'**orthographe** : transposer par simple addition de
 * demi-tons donnerait « A# » là où le musicien lit « Bb », et l'indice
 * deviendrait plus gênant qu'utile.
 *
 * On garde donc de chaque note ses deux intervalles à la fondamentale :
 * l'intervalle **générique** (une distance de lettres, do→mi = 2) et
 * l'intervalle **chromatique** (une distance de demi-tons, do→mi = 4).
 * Reportés sur la nouvelle fondamentale, ces deux nombres redonnent une lettre
 * et une altération justes, sans table d'exceptions.
 */

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** Hauteur de chaque lettre à l'état naturel, en demi-tons depuis do. */
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11] as const;

/** Mi grave de la guitare — plancher de la tessiture pour placer un motif. */
export const GUITAR_LOW_E = 40;

export interface NoteSpelling {
  /** Une des sept lettres, en majuscule. */
  letter: string;
  /** Altération en demi-tons : -2 (double bémol) à +2 (double dièse). */
  alter: number;
  /**
   * Octave à la convention scientifique (do central = C4 = MIDI 60), ou
   * `null` quand le catalogue ne la précise pas — voir `layoutMotif`.
   */
  octave: number | null;
}

const NOTE_PATTERN = /^([A-Ga-g])(#{1,2}|b{1,2}|♯{1,2}|♭{1,2})?(-?\d)?$/;

function letterIndex(letter: string): number {
  return LETTERS.indexOf(letter.toUpperCase() as (typeof LETTERS)[number]);
}

function naturalPc(index: number): number {
  return NATURAL_PC[index] ?? 0;
}

/** Lit « C », « Bb », « F#3 », « Ebb ». Retourne `null` si ce n'est pas une note. */
export function parseNote(text: string): NoteSpelling | null {
  const match = NOTE_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, rawLetter, rawAlter, rawOctave] = match;
  if (!rawLetter) return null;

  let alter = 0;
  if (rawAlter) {
    const sign = rawAlter[0] === '#' || rawAlter[0] === '♯' ? 1 : -1;
    alter = sign * rawAlter.length;
  }

  return {
    letter: rawLetter.toUpperCase(),
    alter,
    octave: rawOctave === undefined ? null : Number(rawOctave),
  };
}

/** Classe de hauteur (0–11), l'octave ignorée. */
export function pitchClass(note: NoteSpelling): number {
  const raw = naturalPc(letterIndex(note.letter)) + note.alter;
  return ((raw % 12) + 12) % 12;
}

/** Numéro MIDI. Exige une octave — `layoutMotif` la fournit quand elle manque. */
export function midiOf(note: NoteSpelling): number {
  const octave = note.octave ?? 4;
  return (octave + 1) * 12 + naturalPc(letterIndex(note.letter)) + note.alter;
}

export function frequencyOf(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Numéro MIDI le plus proche d'une fréquence, en demi-tons tempérés. */
export function midiFromFrequency(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function formatNote(note: NoteSpelling): string {
  const alter = note.alter > 0 ? '#'.repeat(note.alter) : 'b'.repeat(-note.alter);
  return `${note.letter}${alter}`;
}

/**
 * Fondamentale d'un chiffrage : « Dm7 » → ré, « Bb7(b9) » → si bémol.
 * On ne lit que le début du symbole ; la qualité reste au chiffrage, qui est
 * de toute façon le seul texte affiché à l'écran.
 */
export function chordRoot(symbol: string): NoteSpelling | null {
  const match = /^([A-Ga-g])(#{1,2}|b{1,2}|♯{1,2}|♭{1,2})?/.exec(symbol.trim());
  if (!match) return null;
  return parseNote(match[0]);
}

/**
 * Transpose un chiffrage en conservant sa qualité : « Dm7 » de ré à fa donne
 * « Fm7 ». Seule la fondamentale est réécrite, le suffixe est recopié.
 */
export function transposeChord(symbol: string, from: NoteSpelling, to: NoteSpelling): string {
  const match = /^([A-Ga-g])(#{1,2}|b{1,2}|♯{1,2}|♭{1,2})?/.exec(symbol.trim());
  const root = match ? parseNote(match[0]) : null;
  if (!match || !root) return symbol;
  const suffix = symbol.trim().slice(match[0].length);
  return `${formatNote(transposeNote(root, from, to))}${suffix}`;
}

/**
 * Reporte une note d'une fondamentale sur une autre, orthographe comprise.
 * L'octave n'est conservée que si la note d'origine en portait une.
 */
export function transposeNote(
  note: NoteSpelling,
  from: NoteSpelling,
  to: NoteSpelling,
): NoteSpelling {
  const generic = (((letterIndex(note.letter) - letterIndex(from.letter)) % 7) + 7) % 7;
  const chromatic = (((pitchClass(note) - pitchClass(from)) % 12) + 12) % 12;

  const index = (letterIndex(to.letter) + generic) % 7;
  const targetPc = (pitchClass(to) + chromatic) % 12;

  // L'altération est l'écart entre la hauteur voulue et la lettre à l'état
  // naturel, ramené au plus court : sans cela un si bémol s'écrirait « B+11 ».
  let alter = targetPc - naturalPc(index);
  while (alter > 6) alter -= 12;
  while (alter < -6) alter += 12;

  const letter = LETTERS[index] ?? 'C';
  if (note.octave === null) return { letter, alter, octave: null };

  // Le motif transposé monte toujours (0 à 11 demi-tons) : c'est l'écart de
  // classes de hauteur qui fixe l'octave, pas la lettre d'arrivée.
  const shift = (((pitchClass(to) - pitchClass(from)) % 12) + 12) % 12;
  const midi = midiOf(note) + shift;
  const octave = Math.floor((midi - naturalPc(index) - alter) / 12) - 1;
  return { letter, alter, octave };
}

/**
 * Donne une octave à chaque note d'un motif, et retourne les hauteurs MIDI.
 *
 * Le catalogue est écrit sans octaves — un musicien note « D F A C », pas
 * « D3 F3 A3 C4 ». On place donc la fondamentale au plus bas de la tessiture
 * de la guitare, puis chaque note **monte** jusqu'à dépasser la précédente :
 * un arpège écrit dans l'ordre ascendant l'est réellement, et le détecteur a
 * des hauteurs exactes à comparer.
 *
 * Une octave explicitement écrite est respectée telle quelle, ce qui permet de
 * noter un motif qui redescend en son milieu (« D3 F3 A3 C4 A3 F3 »).
 */
export function layoutMotif(notes: NoteSpelling[], floor = GUITAR_LOW_E): number[] {
  const midis: number[] = [];
  let previous = -Infinity;

  for (const note of notes) {
    if (note.octave !== null) {
      const midi = midiOf(note);
      midis.push(midi);
      previous = midi;
      continue;
    }

    // Plus basse occurrence de cette classe de hauteur au-dessus du plancher…
    const pc = pitchClass(note);
    let midi = floor + (((pc - floor) % 12) + 12) % 12;
    // …puis on la remonte tant qu'elle n'a pas dépassé la note précédente.
    while (midi <= previous) midi += 12;
    midis.push(midi);
    previous = midi;
  }

  return midis;
}
