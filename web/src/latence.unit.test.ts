import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeWav16 } from './diagnostic-micro';
import { MesureLatence } from './latence';

const SR = 48000;

/** Clic du métronome : sinusoïde 600 Hz, 2 ms de montée, décroissance exponentielle. */
function clic(signal: Float32Array, at: number, amplitude = 0.3): void {
  for (let i = 0; i < 0.05 * SR && at + i < signal.length; i += 1) {
    const env = Math.min(1, i / (0.002 * SR)) * Math.exp(-i / (0.012 * SR));
    signal[at + i] = (signal[at + i] ?? 0) + amplitude * env * Math.sin((2 * Math.PI * 600 * i) / SR);
  }
}

function mesurer(signal: Float32Array, clics: number[], sampleRate = SR): MesureLatence {
  const m = new MesureLatence(sampleRate);
  for (const t of clics) m.clic(t);
  for (let f = 0; f + 512 <= signal.length; f += 512) m.push(f, signal.slice(f, f + 512));
  return m;
}

describe('MesureLatence', () => {
  it('retrouve le retard des clics à quelques millisecondes près', () => {
    for (const retardMs of [20, 85, 180]) {
      const signal = new Float32Array(SR * 4);
      const programmes = [0.5, 1.2, 1.9, 2.6];
      for (const t of programmes) clic(signal, Math.round((t + retardMs / 1000) * SR));
      const latence = mesurer(signal, programmes).latence();
      expect(latence, `retard ${retardMs} ms`).not.toBeNull();
      expect(Math.abs((latence ?? 0) * 1000 - retardMs), `retard ${retardMs} ms`).toBeLessThan(6);
    }
  });

  it('ne mesure rien quand le micro n’entend pas les clics (casque)', () => {
    const signal = Float32Array.from({ length: SR * 3 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 110 * i) / SR));
    expect(mesurer(signal, [0.5, 1.2, 1.9]).latence()).toBeNull();
  });

  it('ne se laisse pas tromper par une guitare qui sonne pendant le décompte', () => {
    const signal = Float32Array.from({ length: SR * 3 }, (_, i) =>
      0.3 * Math.exp(-i / SR) * (Math.sin((2 * Math.PI * 110 * i) / SR) + 0.5 * Math.sin((2 * Math.PI * 330 * i) / SR)),
    );
    for (const t of [0.5, 1.2, 1.9]) clic(signal, Math.round((t + 0.085) * SR), 0.1);
    expect(Math.abs((mesurer(signal, [0.5, 1.2, 1.9]).latence() ?? 0) * 1000 - 85)).toBeLessThan(6);
  });

  it('mesure ~85 ms sur les prises réelles au métronome', () => {
    // Les clics du décompte n'étaient pas consignés dans ces prises : on les
    // retrouve en remontant de la première battue, d'une battue par clic.
    const F = join(__dirname, '__fixtures__', 'micro');
    for (const n of ['arpege-am-eval', 'gamme-c-eval']) {
      const b = readFileSync(join(F, n + '.wav'));
      const { samples, sampleRate } = decodeWav16(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      const j = JSON.parse(readFileSync(join(F, n + '.json'), 'utf8')) as {
        debutAudio: number;
        meta: { bpm: number };
        battues: { time: number }[];
      };
      const premiere = (j.battues[0]?.time ?? 0) - j.debutAudio;
      const clics = [1, 2, 3, 4].map((k) => premiere - (k * 60) / j.meta.bpm).filter((t) => t > 0.06);
      const m = mesurer(samples, clics, sampleRate);
      expect(m.entendus, n).toBe(clics.length);
      expect((m.latence() ?? 0) * 1000, n).toBeGreaterThan(70);
      expect((m.latence() ?? 0) * 1000, n).toBeLessThan(100);
    }
  });
});
