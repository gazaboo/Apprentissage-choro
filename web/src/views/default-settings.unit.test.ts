import { describe, expect, it } from 'vitest';
import { hasContrechantData } from './default-settings';
import type { Song } from '../types';

describe('hasContrechantData', () => {
  it('est toujours faux aujourd’hui, tant que #80 n’a pas ajouté de données contraponto', () => {
    const songs: Song[] = [
      {
        id: 'choro-a',
        title: 'Choro de test',
        composer: 'Compositeur',
        audio: { reference: null, playback: null },
        instruments: [{ id: 'c', name: 'Ut', page_count: 0, measure_count: 0, pages: [] }],
      },
    ];
    expect(hasContrechantData(songs)).toBe(false);
    expect(hasContrechantData([])).toBe(false);
  });
});
