import { describe, expect, it } from 'vitest';
import {
  formatNote,
  frequencyOf,
  GUITAR_LOW_E,
  layoutMotif,
  midiFromFrequency,
  midiOf,
  nameFromMidi,
  parseNote,
  pitchClass,
  transposeChord,
  transposeNote,
} from './theorie';

describe('parseNote', () => {
  it('lit une note naturelle sans octave', () => {
    expect(parseNote('C')).toEqual({ letter: 'C', alter: 0, octave: null });
  });

  it('lit un bémol avec octave', () => {
    expect(parseNote('Bb3')).toEqual({ letter: 'B', alter: -1, octave: 3 });
  });

  it('lit un double dièse', () => {
    expect(parseNote('F##')).toEqual({ letter: 'F', alter: 2, octave: null });
  });

  it("rejette ce qui n'est pas une note", () => {
    expect(parseNote('H')).toBeNull();
    expect(parseNote('')).toBeNull();
  });

  it('round-trip parseNote/formatNote sur une double altération', () => {
    expect(formatNote(parseNote('F##')!)).toBe('F##');
    expect(formatNote(parseNote('Ebb')!)).toBe('Ebb');
  });
});

describe('frequencyOf / midiFromFrequency', () => {
  it('MIDI 69 (A4) vaut 440 Hz, et le round-trip retombe sur le même MIDI', () => {
    expect(frequencyOf(69)).toBe(440);
    expect(midiFromFrequency(440)).toBeCloseTo(69, 9);
  });

  it('round-trip fréquence→MIDI→fréquence sur plusieurs hauteurs', () => {
    for (const midi of [40, 60, 69, 81, 96]) {
      const freq = frequencyOf(midi);
      expect(midiFromFrequency(freq)).toBeCloseTo(midi, 9);
    }
  });
});

describe('pitchClass / midiOf', () => {
  it('Bb et A# ont la même classe de hauteur', () => {
    expect(pitchClass(parseNote('Bb')!)).toBe(pitchClass(parseNote('A#')!));
  });

  it('C4 est le do central (MIDI 60)', () => {
    expect(midiOf(parseNote('C4')!)).toBe(60);
  });
});

describe('transposeNote', () => {
  it('conserve la lettre générique et redonne une orthographe usuelle (D→F, Dm7→Fm7)', () => {
    const from = parseNote('D')!;
    const to = parseNote('F')!;
    // Ré, la fondamentale elle-même : transposée sur fa, elle redevient la
    // fondamentale.
    expect(formatNote(transposeNote(from, from, to))).toBe('F');
  });

  it("n'introduit pas d'enharmonie disgracieuse (do dièse plutôt que ré bémol s'écrit correctement une fois reporté)", () => {
    const from = parseNote('C')!;
    const to = parseNote('Eb')!;
    // Mi dans la tonalité de do, reporté sur mi bémol : sol.
    const mi = parseNote('E')!;
    expect(formatNote(transposeNote(mi, from, to))).toBe('G');
  });

  it("respecte l'octave quand la note d'origine en porte une : la classe de hauteur seule fixe le décalage", () => {
    const from = parseNote('D')!;
    const to = parseNote('F')!;
    const note = parseNote('D3')!;
    const transposed = transposeNote(note, from, to);
    expect(transposed.octave).not.toBeNull();
    expect(midiOf(transposed)).toBe(midiOf(note) + 3); // ré→fa = 3 demi-tons
  });
});

describe('transposeChord', () => {
  it('réécrit la fondamentale et conserve le suffixe de qualité', () => {
    expect(transposeChord('Dm7', parseNote('D')!, parseNote('F')!)).toBe('Fm7');
  });
});

describe('layoutMotif', () => {
  it('place chaque note sans octave strictement au-dessus de la précédente', () => {
    const notes = ['D', 'F', 'A', 'D'].map((n) => parseNote(n)!);
    const midis = layoutMotif(notes);
    for (let i = 1; i < midis.length; i += 1) {
      expect(midis[i]).toBeGreaterThan(midis[i - 1]!);
    }
  });

  it('respecte une octave écrite explicitement, y compris pour redescendre en cours de motif', () => {
    const notes = ['D3', 'F3', 'A3', 'C4', 'A3'].map((n) => parseNote(n)!);
    const midis = layoutMotif(notes);
    expect(midis).toEqual(notes.map((n) => midiOf(n)));
  });
});

describe('nameFromMidi', () => {
  it('nomme le do central et le la du diapason', () => {
    expect(nameFromMidi(60)).toBe('C4');
    expect(nameFromMidi(69)).toBe('A4');
  });

  it('écrit les touches noires en dièses, faute de contexte tonal', () => {
    expect(nameFromMidi(61)).toBe('C#4');
    expect(nameFromMidi(70)).toBe('A#4');
  });

  it('garde l’octave, y compris au mi grave de la guitare', () => {
    // L'erreur d'octave est un mode de défaillance connu du détecteur : elle
    // ne se repère que si l'octave est affichée.
    expect(nameFromMidi(GUITAR_LOW_E)).toBe('E2');
    expect(nameFromMidi(GUITAR_LOW_E + 12)).toBe('E3');
  });

  it('descend sous le do 0 sans se casser', () => {
    expect(nameFromMidi(0)).toBe('C-1');
  });

  it('arrondit au demi-ton le plus proche', () => {
    expect(nameFromMidi(59.6)).toBe('C4');
    expect(nameFromMidi(midiFromFrequency(frequencyOf(64)))).toBe('E4');
  });
});
