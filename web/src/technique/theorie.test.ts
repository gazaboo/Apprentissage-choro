import { describe, expect, it } from 'vitest';
import {
  formatNote,
  layoutMotif,
  midiOf,
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
