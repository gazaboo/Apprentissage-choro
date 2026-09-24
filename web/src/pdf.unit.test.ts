import { describe, expect, it } from 'vitest';
import { A4, buildPdf, fitImage, pdfFileName, pdfString, pdfVersions } from './pdf';
import type { Instrument, InstrumentId, Page, Song } from './types';

const page = (dir: string, n: number): Page => ({
  page_number: n,
  image_path: `data/x/${dir}/page_${n}.webp`,
  measures_source: 'vector',
  measures: [],
});

const instrument = (id: InstrumentId, pages: Page[]): Instrument => ({
  id,
  name: id,
  page_count: pages.length,
  measure_count: 0,
  pages,
});

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 'benzinho-jacob-do-bandolim',
    title: 'Benzinho',
    composer: 'Jacob do Bandolim',
    audio: { reference: null, playback: null },
    instruments: [instrument('c', [page('c', 1), page('c', 2)])],
    contraponto: null,
    ...overrides,
  };
}

const latin1 = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

describe('pdfVersions', () => {
  it('ne propose que les versions présentes, dans l’ordre Ut, Si♭, Mi♭, contre-chant', () => {
    const versions = pdfVersions(
      song({
        instruments: [
          instrument('eb', [page('eb', 1)]),
          instrument('c', [page('c', 1)]),
          instrument('bb', [page('bb', 1)]),
        ],
        contraponto: { page_count: 1, measure_count: 0, pages: [page('contraponto', 1)] },
      }),
    );
    expect(versions.map((v) => v.id)).toEqual(['c', 'bb', 'eb', 'contraponto']);
    expect(versions.map((v) => v.label)).toEqual(['Ut', 'Si♭', 'Mi♭', 'Ut + contre-chant']);
  });

  it('omet le contre-chant absent et une tonalité sans page', () => {
    const versions = pdfVersions(
      song({ instruments: [instrument('c', [page('c', 1)]), instrument('bb', [])] }),
    );
    expect(versions.map((v) => v.id)).toEqual(['c']);
  });

  it('remet les pages dans l’ordre de lecture', () => {
    const [ut] = pdfVersions(
      song({ instruments: [instrument('c', [page('c', 3), page('c', 1), page('c', 2)])] }),
    );
    expect(ut!.pages.map((p) => p.image_path)).toEqual([
      'data/x/c/page_1.webp',
      'data/x/c/page_2.webp',
      'data/x/c/page_3.webp',
    ]);
  });
});

describe('pdfFileName', () => {
  it('suffixe le nom par la version, sans caractère spécial', () => {
    expect(pdfFileName(song(), 'bb')).toBe('benzinho-jacob-do-bandolim-si-b.pdf');
    expect(pdfFileName(song(), 'contraponto')).toBe(
      'benzinho-jacob-do-bandolim-ut-contre-chant.pdf',
    );
  });
});

describe('pdfString', () => {
  it('échappe les parenthèses et encode accents et bémols en WinAnsi', () => {
    expect(latin1(pdfString('Choro (Si♭) é\\'))).toBe('(Choro \\(Sib\\) \xe9\\\\)');
    expect(latin1(pdfString('l’étude — ok'))).toBe('(l\x92\xe9tude \x97 ok)');
    expect(latin1(pdfString('日'))).toBe('(?)');
  });
});

describe('fitImage', () => {
  const box = { x: 36, y: 50, w: 523, h: 720 };
  it('garde les proportions, centre en largeur et cale en haut', () => {
    const paysage = fitImage({ width: 2000, height: 1000 }, box);
    expect(paysage.w).toBeCloseTo(523);
    expect(paysage.h).toBeCloseTo(261.5);
    expect(paysage.y + paysage.h).toBeCloseTo(box.y + box.h);
    const portrait = fitImage({ width: 1000, height: 2000 }, box);
    expect(portrait.h).toBeCloseTo(720);
    expect(portrait.x - box.x).toBeCloseTo(box.x + box.w - (portrait.x + portrait.w));
  });
});

describe('buildPdf', () => {
  // Faux JPEG reconnaissables : l'ordre des pages se lit dans le fichier.
  const images = ['PAGE-UN', 'PAGE-DEUX', 'PAGE-TROIS'].map((marker, i) => ({
    jpeg: new TextEncoder().encode(marker),
    width: 1000 + i,
    height: 1400,
  }));
  const pdf = latin1(
    buildPdf({ title: 'Benzinho', subtitle: 'Jacob do Bandolim · Si♭', footer: 'Note', images }),
  );

  it('produit un PDF à une page A4 par image, dans l’ordre', () => {
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('/Count 3');
    expect(pdf.match(/\/Type \/Page /g)).toHaveLength(3);
    expect(pdf).toContain(`/MediaBox [0 0 ${A4.width} ${A4.height}]`);
    const positions = ['PAGE-UN', 'PAGE-DEUX', 'PAGE-TROIS'].map((m) => pdf.indexOf(m));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(pdf).toContain('/Width 1001 /Height 1400');
  });

  it('numérote les pages dans l’en-tête', () => {
    expect(pdf).toContain('(Benzinho) Tj');
    expect(pdf).toContain('(Jacob do Bandolim \xb7 Sib \xb7 page 2/3) Tj');
  });

  it('a une table de renvois qui pointe sur chaque objet', () => {
    const startxref = Number(pdf.match(/startxref\n(\d+)\n/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const entries = pdf.slice(startxref).match(/^\d{10} 00000 n $/gm)!;
    expect(entries).toHaveLength(4 + 3 * 3);
    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(pdf.slice(offset, offset + 12)).toMatch(new RegExp(`^${index + 1} 0 obj\\n`));
    });
    // Chaque flux annonce sa longueur exacte.
    for (const match of pdf.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
      const start = match.index! + match[0].length;
      expect(pdf.slice(start + Number(match[1]), start + Number(match[1]) + 10)).toBe(
        '\nendstream',
      );
    }
  });
});
