import { describe, expect, it } from 'vitest';
import { hasContrechantData } from './default-settings';
import type { Song } from '../types';

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 'choro-a',
    title: 'Choro de test',
    composer: 'Compositeur',
    audio: { reference: null, playback: null },
    instruments: [{ id: 'c', name: 'Ut', page_count: 0, measure_count: 0, pages: [] }],
    contraponto: null,
    ...overrides,
  };
}

describe('hasContrechantData', () => {
  it('est faux quand aucun morceau n’a de contraponto', () => {
    expect(hasContrechantData([song()])).toBe(false);
    expect(hasContrechantData([])).toBe(false);
  });

  it('est vrai dès qu’un morceau a un contraponto', () => {
    const songs: Song[] = [
      song(),
      song({
        id: 'choro-b',
        contraponto: { page_count: 1, measure_count: 4, pages: [] },
      }),
    ];
    expect(hasContrechantData(songs)).toBe(true);
  });
});
