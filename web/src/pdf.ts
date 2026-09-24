/**
 * Export d'une partition en PDF (#171), assemblé dans le navigateur à partir
 * des images de pages déjà servies — donc aussi hors ligne, et toujours
 * cohérent avec les images corrigées. Pas de dépendance : un PDF d'images
 * JPEG n'a besoin que d'un en-tête, d'une police standard (Helvetica, jamais
 * embarquée) et d'une table de renvois, que ce module écrit lui-même.
 *
 * Ce fichier ne touche pas au DOM (testable sous Node) ; la rastérisation
 * des `.webp` en JPEG et le téléchargement vivent dans `pdfExport.ts`.
 */

import type { InstrumentId, Page, Song } from './types';

export type PdfVersionId = InstrumentId | 'contraponto';

export interface PdfVersion {
  id: PdfVersionId;
  /** Libellé court, repris dans l'en-tête du PDF et le nom du fichier. */
  label: string;
  /** Pages dans l'ordre de lecture. */
  pages: Page[];
}

const VERSION_LABELS: Record<PdfVersionId, string> = {
  c: 'Ut',
  bb: 'Si♭',
  eb: 'Mi♭',
  contraponto: 'Ut + contre-chant',
};

const VERSION_ORDER: PdfVersionId[] = ['c', 'bb', 'eb', 'contraponto'];

/** Versions téléchargeables d'un morceau, dans un ordre fixe (Ut, Si♭, Mi♭,
 *  contre-chant), limitées à celles qui ont au moins une page. */
export function pdfVersions(song: Song): PdfVersion[] {
  const pagesOf = (id: PdfVersionId): Page[] | undefined =>
    id === 'contraponto'
      ? song.contraponto?.pages
      : song.instruments.find((instrument) => instrument.id === id)?.pages;
  const versions: PdfVersion[] = [];
  for (const id of VERSION_ORDER) {
    const pages = pagesOf(id);
    if (!pages || pages.length === 0) continue;
    versions.push({
      id,
      label: VERSION_LABELS[id],
      pages: [...pages].sort((a, b) => a.page_number - b.page_number),
    });
  }
  return versions;
}

/** Nom de fichier proposé : `benzinho-jacob-do-bandolim-si-b.pdf`. */
export function pdfFileName(song: Song, version: PdfVersionId): string {
  const suffix: Record<PdfVersionId, string> = {
    c: 'ut',
    bb: 'si-b',
    eb: 'mi-b',
    contraponto: 'ut-contre-chant',
  };
  return `${song.id}-${suffix[version]}.pdf`;
}

// --- Écriture du PDF ------------------------------------------------------

export interface PdfImage {
  /** Octets d'un JPEG (baseline), inséré tel quel (filtre DCTDecode). */
  jpeg: Uint8Array;
  width: number;
  height: number;
}

export interface PdfDocument {
  title: string;
  /** Seconde ligne d'en-tête (compositeur, version) ; « page n/N » est ajouté. */
  subtitle: string;
  /** Mention discrète en pied de page (source, usage). */
  footer: string;
  images: PdfImage[];
}

/** A4 en points PDF (1/72 de pouce). */
export const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 36;
const HEADER_HEIGHT = 34;
const FOOTER_HEIGHT = 14;

/** Caractères hors Latin-1 que WinAnsiEncoding sait tout de même rendre. */
const WIN_ANSI_EXTRA: Record<string, number> = {
  '’': 0x92,
  '‘': 0x91,
  '“': 0x93,
  '”': 0x94,
  '–': 0x96,
  '—': 0x97,
  '…': 0x85,
  '•': 0x95,
  '♭': 0x62, // « b » : pas de bémol dans les polices standard
  '♯': 0x23, // « # »
};

/** Chaîne littérale PDF `(…)` en WinAnsiEncoding ; les caractères
 *  impossibles à rendre deviennent « ? ». */
export function pdfString(text: string): Uint8Array {
  const bytes: number[] = [0x28];
  for (const char of text.normalize('NFC')) {
    let code = WIN_ANSI_EXTRA[char] ?? char.codePointAt(0)!;
    if (code > 0xff || (code >= 0x80 && code < 0xa0 && !(char in WIN_ANSI_EXTRA))) code = 0x3f;
    if (code === 0x28 || code === 0x29 || code === 0x5c) bytes.push(0x5c);
    bytes.push(code);
  }
  bytes.push(0x29);
  return Uint8Array.from(bytes);
}

/** Place une image dans une boîte en conservant ses proportions : centrée
 *  horizontalement, calée en haut (une partition se lit de haut en bas). */
export function fitImage(
  image: { width: number; height: number },
  box: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + box.h - h, w, h };
}

const num = (value: number): string => (Math.round(value * 100) / 100).toString();

/** Assemble le PDF : une page A4 par image, dans l'ordre donné. */
export function buildPdf(doc: PdfDocument): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const write = (part: string | Uint8Array): void => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const concat = (...parts: (string | Uint8Array)[]): Uint8Array<ArrayBuffer> => {
    const bytes = parts.map((part) => (typeof part === 'string' ? encoder.encode(part) : part));
    const out = new Uint8Array(bytes.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of bytes) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };
  const object = (id: number, body: string | Uint8Array): void => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
    write(body);
    write('\nendobj\n');
  };
  const stream = (dict: string, data: Uint8Array): Uint8Array =>
    concat(`<< ${dict} /Length ${data.length} >>\nstream\n`, data, '\nendstream');

  // Objets 1 à 4 fixes, puis trois par page : page, contenu, image.
  const count = doc.images.length;
  const pageId = (index: number): number => 5 + index * 3;
  const total = 5 + count * 3;

  write('%PDF-1.4\n');
  // Commentaire d'octets > 127 : signale un fichier binaire aux outils de transfert.
  write(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = doc.images.map((_, index) => `${pageId(index)} 0 R`).join(' ');
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`);
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  object(
    4,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  const imageBox = {
    x: MARGIN,
    y: MARGIN + FOOTER_HEIGHT,
    w: A4.width - 2 * MARGIN,
    h: A4.height - 2 * MARGIN - HEADER_HEIGHT - FOOTER_HEIGHT,
  };
  const top = A4.height - MARGIN;

  doc.images.forEach((image, index) => {
    const id = pageId(index);
    const placed = fitImage(image, imageBox);
    const content = concat(
      `BT /F2 13 Tf 0 g ${num(MARGIN)} ${num(top - 12)} Td `,
      pdfString(doc.title),
      ' Tj ET\n',
      `BT /F1 9 Tf 0.35 g ${num(MARGIN)} ${num(top - 26)} Td `,
      pdfString(`${doc.subtitle} · page ${index + 1}/${count}`),
      ' Tj ET\n',
      `BT /F1 7 Tf 0.5 g ${num(MARGIN)} ${num(MARGIN)} Td `,
      pdfString(doc.footer),
      ' Tj ET\n',
      `q ${num(placed.w)} 0 0 ${num(placed.h)} ${num(placed.x)} ${num(placed.y)} cm /Im0 Do Q\n`,
    );
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im0 ${id + 2} 0 R >> >> ` +
        `/Contents ${id + 1} 0 R >>`,
    );
    object(id + 1, stream('', content));
    object(
      id + 2,
      stream(
        `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
          '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
        image.jpeg,
      ),
    );
  });

  const xref = length;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id++) {
    table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  write(table);
  write(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return concat(...chunks);
}
