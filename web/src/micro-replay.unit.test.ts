import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeWav16 } from './diagnostic-micro';
import { chaineEntree, noterPrise, notch, rejouer } from './micro-replay';
import { DetecteurSaturation } from './pitch';
import { nameFromMidi } from './technique/theorie';

function sine(frequency: number, sampleRate: number, length: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => Math.sin((2 * Math.PI * frequency * i) / sampleRate));
}

function rms(signal: Float32Array): number {
  return Math.sqrt(signal.reduce((sum, x) => sum + x * x, 0) / signal.length);
}

describe('rejeu hors ligne', () => {
  it('le coupe-bande retire le clic et laisse passer la corde', () => {
    const sr = 48000;
    const clic = notch(sine(800, sr, sr), sr, 800, 20).slice(sr / 2);
    const corde = notch(sine(220, sr, sr), sr, 800, 20).slice(sr / 2);
    expect(rms(clic)).toBeLessThan(0.01);
    expect(rms(corde)).toBeGreaterThan(0.69);
  });

  it('date chaque note de l’instant où elle sort du flux', () => {
    const sr = 44100;
    const signal = new Float32Array(sr);
    const note = sine(220, sr, sr / 2);
    for (let i = 0; i < note.length; i += 1) signal[sr / 4 + i] = (note[i] ?? 0) * 0.3 * Math.exp(-i / sr);
    const [onset] = rejouer(signal, sr);
    expect(onset && nameFromMidi(onset.midi)).toBe('A3');
    // 100 ms d'attente + la plus longue des fenêtres (3072, celle de
    // l'octave), + au plus un lot de 512 et un pas d'analyse d'attaque.
    const delai = (onset?.emisA ?? 0) - (onset?.audioTime ?? 0);
    expect(delai).toBeGreaterThan(0.1 + 3072 / sr - 0.001);
    expect(delai).toBeLessThan(0.1 + (3072 + 512 + 256) / sr);
  });
});

/**
 * Prises réelles (`?debug=micro` → « Télécharger le diagnostic micro »),
 * déposées dans `src/__fixtures__/micro/` avec leur JSON. Ce bloc ne juge pas
 * encore : il rejoue chaque prise et écrit à côté un `.rapport.txt` — ce que
 * le rejeu entend, face à ce que la page avait entendu sur le moment et à ce
 * que l'exercice attendait.
 */
const FIXTURES = join(__dirname, '__fixtures__', 'micro');
const prises = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => f.endsWith('.wav')) : [];

interface JournalJson {
  debutAudio: number | null;
  meta?: { midi?: number[]; bpm?: number; mode?: string };
  onsets: { audioTime: number; midi: number; frequency: number; clarte: number; emisA: number }[];
  battues: { index: number; time: number }[];
}

describe.skipIf(prises.length === 0)('prises réelles', () => {
  it.each(prises)('%s', (fichier) => {
    const buffer = readFileSync(join(FIXTURES, fichier));
    const { samples, sampleRate } = decodeWav16(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
    const cheminJson = join(FIXTURES, fichier.replace(/\.wav$/, '.json'));
    const journal: JournalJson | null = existsSync(cheminJson)
      ? (JSON.parse(readFileSync(cheminJson, 'utf8')) as JournalJson)
      : null;
    const debut = journal?.debutAudio ?? 0;

    const ligne = (t: number, midi: number, hz: number, clarte: number, rendu: number): string =>
      `${t.toFixed(3).padStart(8)} s  ${nameFromMidi(midi).padEnd(4)}${hz.toFixed(1).padStart(7)} Hz`
      + `  clarté ${clarte.toFixed(2)}  rendu +${Math.round(rendu * 1000)} ms`;

    const onsets = rejouer(samples, sampleRate);
    const sections = [
      `${fichier} — ${(samples.length / sampleRate).toFixed(1)} s à ${sampleRate} Hz`,
      journal?.meta?.midi
        ? `attendu (${journal.meta.mode ?? '?'}, ${journal.meta.bpm ?? '?'} bpm) : `
          + journal.meta.midi.map(nameFromMidi).join(' ')
        : 'attendu : ?',
      `\n# Rejeu hors ligne — ${onsets.length} notes`,
      ...onsets.map((o) => ligne(o.audioTime, o.midi, o.frequency, o.clarte, o.emisA - o.audioTime)),
    ];
    if (journal) {
      sections.push(
        `\n# Dans la page — ${journal.onsets.length} notes (temps depuis le début du WAV)`,
        ...journal.onsets.map((o) =>
          ligne(o.audioTime - debut, o.midi, o.frequency, o.clarte, o.emisA - o.audioTime),
        ),
      );
      if (journal.battues.length > 0) {
        sections.push(
          `\n# Battues — ${journal.battues.length}`,
          ...journal.battues.map((b) => `${(b.time - debut).toFixed(3).padStart(8)} s  temps ${b.index}`),
        );
      }
    }
    const cheminVerite = join(FIXTURES, fichier.replace(/\.wav$/, '.verite.json'));
    if (existsSync(cheminVerite)) {
      const verite = JSON.parse(readFileSync(cheminVerite, 'utf8')) as {
        sature?: boolean;
        justesMin?: number;
        notes: { t: number; midi: number; incertain?: boolean }[];
      };
      const s = noterPrise(onsets, verite.notes);
      sections.splice(
        2,
        0,
        `score : ${s.justes}/${s.notes} justes, ${s.octave} octave, ${s.fausses} fausses, `
          + `${s.manquees} manquées, ${s.enTrop} en trop, rendu médian ${s.renduMedianMs} ms`,
      );

      // Plancher : ce que la détection retrouve aujourd'hui sur cette prise.
      // Il ne doit que monter — c'est la garde contre un réglage qui
      // arrangerait des signaux synthétiques au détriment du vrai jeu.
      if (verite.justesMin !== undefined) {
        expect(s.justes, `notes justes (${s.octave} octave, ${s.fausses} fausses, ${s.manquees} manquées)`)
          .toBeGreaterThanOrEqual(verite.justesMin);
      }

      // L'alerte de saturation doit dire vrai sur chaque prise étiquetée.
      const detecteur = new DetecteurSaturation(sampleRate);
      const filtre = chaineEntree(samples, sampleRate);
      let alerte = false;
      for (let i = 0; i + 512 <= filtre.length; i += 512) {
        alerte = detecteur.push(filtre.slice(i, i + 512)) || alerte;
      }
      expect(alerte, 'alerte de saturation').toBe(verite.sature ?? false);
    }
    writeFileSync(join(FIXTURES, fichier.replace(/\.wav$/, '.rapport.txt')), `${sections.join('\n')}\n`);
    expect(samples.length).toBeGreaterThan(0);
  });
});
