/**
 * Côté navigateur de l'export PDF (#171) : rastérise chaque page `.webp` en
 * JPEG via un canvas, assemble le PDF (`pdf.ts`) et le propose au
 * téléchargement. Les images passent par le cache du service worker : une
 * partition déjà ouverte s'exporte aussi hors ligne.
 */

import { buildPdf, pdfFileName, pdfVersions } from './pdf';
import type { PdfImage, PdfVersionId } from './pdf';
import type { Song } from './types';

/** Au-delà, la page est réduite : ~240 DPI sur la largeur d'un A4, bien assez
 *  pour l'impression, et un fichier deux fois plus léger que les 300 DPI d'origine. */
const MAX_WIDTH = 2000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image introuvable : ${src}`));
    img.src = src;
  });
}

async function toJpeg(src: string): Promise<PdfImage> {
  const img = await loadImage(src);
  const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  // Fond blanc : une zone transparente deviendrait noire en JPEG.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Conversion JPEG impossible'))),
      'image/jpeg',
      0.88,
    ),
  );
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/** Construit le PDF de la version demandée et déclenche son téléchargement. */
export async function downloadScorePdf(song: Song, versionId: PdfVersionId): Promise<void> {
  const version = pdfVersions(song).find((candidate) => candidate.id === versionId);
  if (!version) throw new Error(`Version absente : ${versionId}`);
  const images: PdfImage[] = [];
  for (const page of version.pages) images.push(await toJpeg(page.image_path));
  const bytes = buildPdf({
    title: song.title,
    subtitle: `${song.composer} · ${version.label}`,
    footer: 'Exporté depuis Choros — entraînement, pour l’étude personnelle.',
    images,
  });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = pdfFileName(song, versionId);
  document.body.append(link);
  link.click();
  link.remove();
  // Laisser au navigateur (et à l'aperçu iOS) le temps de lire le blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
