import { describe, expect, it } from 'vitest';
import { JournalMicro, decodeWav16, diagnosticMicroActif, encodeWav16 } from './diagnostic-micro';

describe('diagnostic micro', () => {
  it("ne s'active qu'avec ?debug=micro", () => {
    expect(diagnosticMicroActif('')).toBe(false);
    expect(diagnosticMicroActif('?debug=autre')).toBe(false);
    expect(diagnosticMicroActif('?debug=micro')).toBe(true);
    expect(diagnosticMicroActif('?x=1&debug=autre&debug=micro')).toBe(true);
  });

  it('relit le WAV qu’il écrit, à la quantification près', () => {
    const samples = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7) * 0.8);
    const { samples: relu, sampleRate } = decodeWav16(encodeWav16(samples, 48000));
    expect(sampleRate).toBe(48000);
    expect(relu.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      expect(Math.abs((relu[i] ?? 0) - (samples[i] ?? 0))).toBeLessThan(1e-4);
    }
  });

  it('comble de silence un lot perdu, pour garder l’horloge juste', () => {
    const journal = new JournalMicro();
    journal.echantillons(1000, new Float32Array(512).fill(0.5));
    journal.echantillons(1000 + 1024, new Float32Array(512).fill(0.5));
    const { json, wav } = journal.exporter();
    const { samples } = decodeWav16(wav);
    expect(samples.length).toBe(1536);
    expect(samples[600]).toBe(0);
    expect(samples[1100]).toBeCloseTo(0.5, 3);
    expect(JSON.parse(json).onsets).toEqual([]);
  });
});
