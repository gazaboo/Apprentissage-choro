import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { simplifyChord } from './grille';
import { isGrille, type Grille, type GrilleCell } from './types';

/* Les grilles de `public/data/grilles/` sont relevées à la main, morceau par
 * morceau : ce test garde qu'aucune ne casse l'écran (garde `isGrille`) ni
 * n'affiche un chiffrage que la simplification ne sait pas ramener à l'une de
 * ses cinq formes. */
const DIR = join(__dirname, '..', 'public', 'data', 'grilles');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
const SIMPLE_FORM = /^[A-G][#b]?(?:m|7|dim|m7b5)?$/;

function allCells(grille: Grille): GrilleCell[] {
  const cells: GrilleCell[] = [...(grille.coda ?? [])];
  for (const part of grille.parts) {
    cells.push(...(part.transition_in ?? []), ...part.sequence, ...(part.coda ?? []));
    cells.push(...(part.endings?.['1'] ?? []), ...(part.endings?.['2'] ?? []));
  }
  return cells;
}

describe('données des grilles', () => {
  it('couvre chaque morceau du manifeste', () => {
    const manifest = JSON.parse(
      readFileSync(join(DIR, '..', 'manifest.json'), 'utf8'),
    ) as { id: string }[];
    const ids = new Set(files.map((f) => f.replace(/\.json$/, '')));
    expect(manifest.map((song) => song.id).filter((id) => !ids.has(id))).toEqual([]);
  });

  it.each(files)('%s est une grille valide', (file) => {
    const data: unknown = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    expect(isGrille(data)).toBe(true);
    const grille = data as Grille;
    expect(`${grille.song_id}.json`).toBe(file);

    const unsimplified = allCells(grille)
      .flat()
      .filter((chord) => !SIMPLE_FORM.test(simplifyChord(chord)));
    expect(unsimplified).toEqual([]);
  });
});
