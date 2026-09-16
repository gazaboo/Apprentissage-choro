/** Analyse hors ligne d'un enregistrement réel : ECHANTILLON=/chemin/x.wav */
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { PitchStream, detectPitch } from './pitch';
import { midiFromFrequency, nameFromMidi } from './technique/theorie';

const LOG: string[] = []; const log = (...a: unknown[]) => LOG.push(a.join(' '));

function lireWav(chemin: string): { data: Float32Array; sampleRate: number } {
  const buf = readFileSync(chemin);
  const sampleRate = buf.readUInt32LE(24);
  const canaux = buf.readUInt16LE(22);
  const bits = buf.readUInt16LE(34);
  let off = 12, taille = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (id === 'data') { off += 8; taille = len; break; }
    off += 8 + len + (len % 2);
  }
  const n = Math.floor(taille / (bits / 8) / canaux);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    data[i] = bits === 16
      ? buf.readInt16LE(off + i * 2 * canaux) / 32768
      : buf.readFloatLE(off + i * 4 * canaux);
  }
  return { data, sampleRate };
}

/**
 * Cloche étroite, identique à celle que `PitchTracker` pose sur l'entrée.
 *
 * Sans elle, l'analyse hors ligne ne voit pas le même signal que
 * l'application — et conclut à côté : c'est arrivé, le clic du métronome
 * ressortait ici alors que le filtre l'effaçait dans le navigateur.
 */
function notch(x: Float32Array, frequency: number, sampleRate: number, Q = 20): Float32Array {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(w) / (2 * Q);
  const cosw = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = 1 / a0, b1 = (-2 * cosw) / a0, b2 = 1 / a0;
  const a1 = (-2 * cosw) / a0, a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const xi = x[i] ?? 0;
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
  }
  return y;
}

it('analyse', () => {
  const chemin = process.env.ECHANTILLON;
  if (!chemin) { writeFileSync('/tmp/analyse.txt', 'ECHANTILLON non défini'); return; }
  const brutWav = lireWav(chemin);
  const sampleRate = brutWav.sampleRate;
  // `SANS_FILTRE=1` pour voir le signal tel quel, clic compris.
  const data = process.env.SANS_FILTRE
    ? brutWav.data
    : [600, 800, 1000].reduce((x, f) => notch(x, f, sampleRate), brutWav.data);
  log(`${chemin}${process.env.SANS_FILTRE ? '  (sans le filtre anti-clic)' : '  (filtre anti-clic appliqué, comme dans l\'application)'}`);
  log(`${(data.length / sampleRate).toFixed(2)} s à ${sampleRate} Hz, ${data.length} échantillons`);

  const rms = (a: number, b: number) => { let s = 0; const e = Math.min(b, data.length);
    for (let i = a; i < e; i++) s += (data[i] ?? 0) ** 2; return Math.sqrt(s / Math.max(1, e - a)); };
  let crete = 0; for (let i = 0; i < data.length; i++) crete = Math.max(crete, Math.abs(data[i] ?? 0));
  log(`crête ${crete.toFixed(4)}  RMS global ${rms(0, data.length).toFixed(4)}`);
  const pas = Math.round(sampleRate * 0.1);
  const prof: string[] = [];
  for (let i = 0; i + pas <= data.length; i += pas) prof.push(rms(i, i + pas).toFixed(3));
  log(`niveau tous les 100 ms :\n  ${prof.join(' ')}`);

  const vus: string[] = [];
  const stream = new PitchStream(sampleRate, (o) => vus.push(
    `${o.audioTime.toFixed(3)}s  ${nameFromMidi(o.midi)}  ${o.frequency.toFixed(1)} Hz  ${o.cents >= 0 ? '+' : ''}${o.cents} c  clarte=${o.clarte.toFixed(3)}`));
  const BATCH = 512;
  for (let f = 0; f + BATCH <= data.length; f += BATCH) stream.push(f, data.slice(f, f + BATCH));
  log(`\n=== ${vus.length} attaque(s) retenue(s) par le detecteur ===`);
  for (const v of vus) log('  ' + v);

  log(`\n=== hauteur toutes les 100 ms, sans passer par la detection d'attaque ===`);
  const brut: string[] = [];
  for (let i = 0; i + 2048 <= data.length; i += pas) {
    const r = detectPitch(data.slice(i, i + 2048), sampleRate);
    const t = (i / sampleRate).toFixed(1);
    brut.push(r ? `${t}:${nameFromMidi(Math.round(midiFromFrequency(r.frequency)))}/${r.clarity.toFixed(2)}` : `${t}:-`);
  }
  log('  ' + brut.join('  '));
  writeFileSync('/tmp/analyse.txt', LOG.join('\n'));
});
