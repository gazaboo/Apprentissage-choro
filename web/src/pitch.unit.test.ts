/** Banc d'essai de la détection de hauteur, sur cordes synthétiques.
 *
 * Aucun test ne couvrait ce fichier, et c'est ce qui a laissé passer le bug
 * d'origine : la fenêtre d'analyse enjambait l'attaque, si bien que toute note
 * précédée d'une autre encore sonnante était rejetée. Un cycle navigateur ne
 * l'aurait pas montré non plus — il faut comparer ce qui est joué à ce qui est
 * entendu, note par note, sur des dizaines de cas.
 *
 * Le générateur ci-dessous n'imite pas une guitare pour le plaisir : chacun de
 * ses traits a fait échouer une version du détecteur. Les harmoniques
 * décroissantes cachent la fondamentale ; l'inharmonicité (les cordes réelles
 * ne sonnent pas en multiples exacts) casse la périodicité parfaite ; le
 * transitoire de médiator pollue les premières millisecondes, celles-là mêmes
 * qu'on analyse.
 */

import { describe, expect, it } from 'vitest';
import { DetecteurSaturation, PitchStream, detectPitch, type Onset } from './pitch';
import { midiFromFrequency } from './technique/theorie';

const SR = 44100;

function frequencyOf(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Bruit reproductible : un test qui échoue une fois sur dix ne sert à rien.
 *
 * `xorshift32` et pas un générateur congruentiel : ces derniers laissent une
 * structure périodique que l'autocorrélation retrouve — le test « ne fabrique
 * pas de note à partir de rien » échouait alors sur un bruit qui n'en était
 * pas un.
 */
function makeNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296 - 0.5;
  };
}

const HARMONICS = [1, 0.85, 0.7, 0.6, 0.45, 0.4, 0.3, 0.25, 0.2, 0.15, 0.12, 0.1];

/**
 * Corde pincée : `midi` pendant `frames` échantillons, amplitude `amp`.
 *
 * `fundamental` permet d'affaiblir la fondamentale sans toucher au reste, pour
 * éprouver la résistance à l'erreur d'octave : c'est le cas d'une corde grave
 * captée par un micro d'ordinateur, qui coupe dans le bas.
 */
function pluck(
  midi: number,
  frames: number,
  { amp = 1, seed = 1, fundamental = 1 } = {},
): Float32Array {
  const out = new Float32Array(frames);
  const f0 = frequencyOf(midi);
  const noise = makeNoise(seed);
  // Inharmonicité d'une corde réelle : les partiels montent un peu trop haut.
  const B = 0.00012;

  for (let h = 0; h < HARMONICS.length; h += 1) {
    const n = h + 1;
    const frequency = n * f0 * Math.sqrt(1 + B * n * n);
    if (frequency > SR / 2) break;
    const gain = (HARMONICS[h] ?? 0) * (n === 1 ? fundamental : 1);
    // Double exponentielle : chute rapide après le pincement, puis longue
    // traîne. Un seul exponentiel lent ferait sonner huit notes au même
    // niveau — aucune guitare ne fait ça, et le test deviendrait un test de
    // polyphonie, qu'un détecteur monophonique ne peut pas gagner.
    const quick = 0.12 / Math.sqrt(n);
    const tail = 1.2 / n;
    const phase = (h * 2.3) % (2 * Math.PI);
    for (let i = 0; i < frames; i += 1) {
      const t = i / SR;
      const envelope = 0.65 * Math.exp(-t / quick) + 0.35 * Math.exp(-t / tail);
      out[i] =
        (out[i] ?? 0) +
        gain * envelope * Math.sin(2 * Math.PI * frequency * i / SR + phase);
    }
  }

  for (let i = 0; i < frames; i += 1) {
    const t = i / SR;
    const attack = t < 0.007 ? noise() * 0.9 * (1 - t / 0.007) : 0;
    out[i] = amp * ((out[i] ?? 0) / 3 + attack + noise() * 0.004);
  }
  return out;
}

/**
 * Le clic du métronome, tel que `Metronome.click` le synthétise : une sinusoïde
 * pure sous une enveloppe exponentielle de 30 ms.
 */
function click(frequency: number, peak: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  const DUREE = 0.03;
  const PLANCHER = 0.0001;
  for (let i = 0; i < frames; i += 1) {
    const t = i / SR;
    let gain = 0;
    if (t < 0.002) gain = PLANCHER * (peak / PLANCHER) ** (t / 0.002);
    else if (t < DUREE) gain = peak * (PLANCHER / peak) ** ((t - 0.002) / (DUREE - 0.002));
    out[i] = gain * Math.sin(2 * Math.PI * frequency * t);
  }
  return out;
}

/** Mélange des notes à des instants donnés, comme un arpège laissé sonner. */
function arpeggio(notes: { midi: number; atMs: number }[], totalMs: number): Float32Array {
  const frames = Math.round((totalMs / 1000) * SR);
  const mix = new Float32Array(frames);
  notes.forEach(({ midi, atMs }, k) => {
    const start = Math.round((atMs / 1000) * SR);
    const voice = pluck(midi, frames - start, { seed: k + 1 });
    for (let i = 0; i < voice.length; i += 1) {
      mix[start + i] = (mix[start + i] ?? 0) + (voice[i] ?? 0);
    }
  });
  return mix;
}

/** Fait passer un signal par le flux, en lots de 512 comme le worklet. */
function run(signal: Float32Array): Onset[] {
  const heard: Onset[] = [];
  const stream = new PitchStream(SR, (onset) => heard.push(onset));
  const BATCH = 512;
  for (let frame = 0; frame + BATCH <= signal.length; frame += BATCH) {
    stream.push(frame, signal.slice(frame, frame + BATCH));
  }
  return heard;
}

function midiOf(signal: Float32Array): number | null {
  const found = detectPitch(signal, SR);
  return found === null ? null : Math.round(midiFromFrequency(found.frequency));
}

describe('detectPitch — tessiture de la guitare 7 cordes', () => {
  it('reconnaît chaque demi-ton de C2 à E5', () => {
    const faux: string[] = [];
    for (let midi = 36; midi <= 76; midi += 1) {
      const heard = midiOf(pluck(midi, 2048, { seed: midi }));
      if (heard !== midi) faux.push(`${midi} → ${heard}`);
    }
    expect(faux).toEqual([]);
  });

  it('descend sous le ré grave, que l\'ancienne borne excluait', () => {
    // MIN_MIDI valait 38 (D2) : C2 (36), le plus grave de la 7 cordes, était
    // hors de portée — la note revenait vide, pas fausse, ce qui la rendait
    // indiscernable d'un silence.
    expect(midiOf(pluck(36, 2048, { seed: 36 }))).toBe(36);
    expect(midiOf(pluck(35, 2048, { seed: 35 }))).toBe(35);
  });

  it('ne se trompe pas d\'octave quand la fondamentale est faible', () => {
    // Un micro d'ordinateur coupe dans le bas : la fondamentale d'une corde
    // grave arrive très atténuée, et c'est l'harmonique 2 qui domine.
    for (const midi of [36, 40, 45, 47, 52]) {
      const heard = midiOf(pluck(midi, 2048, { seed: midi, fundamental: 0.15 }));
      expect(heard, `fondamentale faible sur ${midi}`).toBe(midi);
    }
  });

  it('ne prend pas le clic du métronome pour une note', () => {
    // Le clic sort dans les haut-parleurs et le micro l'entend. Sinusoïde pure,
    // il est plus périodique qu'une corde : le détecteur le préférait à la note
    // jouée et annonçait un B5 pile sur le temps. Les fréquences sont celles de
    // `metronome.ts` — décompte, battue, accent.
    for (const [frequence, pic] of [[600, 0.5], [800, 0.3], [1000, 0.5]] as const) {
      const heard = midiOf(click(frequence, pic, 2048));
      expect(heard, `clic à ${frequence} Hz`).toBeNull();
    }
  });

  it('ne fabrique pas de note à partir de rien', () => {
    expect(detectPitch(new Float32Array(2048), SR)).toBeNull();
    const noise = makeNoise(9);
    const bruit = new Float32Array(2048);
    for (let i = 0; i < bruit.length; i += 1) bruit[i] = noise() * 0.3;
    expect(detectPitch(bruit, SR)).toBeNull();
  });
});

describe('PitchStream — notes qui se recouvrent', () => {
  const MOTIF = [47, 48, 52, 57, 53, 52, 48, 45]; // B2 C3 E3 A3 F3 E3 C3 A2

  /** L'arpège du relevé qui a motivé la correction, joué toutes les `gapMs`. */
  function jouer(gapMs: number): Onset[] {
    const notes = MOTIF.map((midi, k) => ({ midi, atMs: 250 + k * gapMs }));
    return run(arpeggio(notes, 250 + gapMs * MOTIF.length + 400));
  }

  it('entend chaque note au tempo de l\'exercice', () => {
    // C'est le cas qui échouait : chaque note sauf la première était analysée
    // mélangée à sa devancière, et rejetée pour manque de périodicité. Une
    // note par seconde est le tempo par défaut (60 bpm).
    expect(jouer(1000).map((o) => o.midi)).toEqual(MOTIF);
  });

  it('tient encore à quatre fois ce tempo', () => {
    expect(jouer(250).map((o) => o.midi)).toEqual(MOTIF);
  });

  it('se tait plutôt que d\'inventer quand ça se serre', () => {
    // Passé ce tempo, plusieurs cordes sonnent ensemble à niveau comparable et
    // aucune détection monophonique ne peut trancher. Ce qu'on exige alors
    // n'est pas l'exhaustivité mais l'honnêteté : les notes rendues sont
    // justes, les autres manquent — on n'en invente pas.
    //
    // La limite est mesurée, pas supposée : vers 150 ms d'écart (≈ 400 à la
    // noire, six fois le tempo par défaut) le détecteur finit par rendre un La
    // une octave trop bas. Ce test borne donc ce qui est promis.
    for (const gap of [200, 180]) {
      const heard = jouer(gap).map((o) => o.midi);
      expect(heard, `écart ${gap} ms`).toEqual(MOTIF.slice(0, heard.length));
      expect(heard.length, `écart ${gap} ms`).toBeGreaterThanOrEqual(5);
    }
  });

  it('date chaque attaque à quelques millisecondes près', () => {
    // L'ancienne version datait l'attaque au mieux à une image d'écran près, et
    // analysait une fenêtre qui la précédait pour moitié.
    const heard = jouer(250);
    const ecarts = heard.map((o, k) => Math.abs(o.audioTime * 1000 - (250 + k * 250)));
    expect(Math.max(...ecarts)).toBeLessThan(20);
  });

  it('rend la fréquence et l\'écart en centièmes, pas seulement un nom', () => {
    // Ce qui permet de distinguer une guitare désaccordée d'une fausse note.
    const heard = run(arpeggio([{ midi: 45, atMs: 250 }], 900));
    expect(heard).toHaveLength(1);
    const [onset] = heard as [Onset];
    expect(onset.frequency).toBeCloseTo(frequencyOf(45), 0);
    expect(Math.abs(onset.cents)).toBeLessThanOrEqual(50);
    expect(onset.clarte).toBeGreaterThan(0.8);
  });

  it('reste muet sur du silence', () => {
    expect(run(new Float32Array(SR))).toEqual([]);
  });
});

describe('DetecteurSaturation', () => {
  const SR_S = 48000;
  const lots = (signal: Float32Array): Float32Array[] => {
    const out: Float32Array[] = [];
    for (let i = 0; i + 512 <= signal.length; i += 512) out.push(signal.slice(i, i + 512));
    return out;
  };
  const sinus = (amplitude: number, secondes: number): Float32Array =>
    Float32Array.from({ length: SR_S * secondes }, (_, i) =>
      Math.max(-1, Math.min(1, amplitude * Math.sin((2 * Math.PI * 110 * i) / SR_S))),
    );

  it('se tait sur un jeu fort mais sous le plafond', () => {
    const d = new DetecteurSaturation(SR_S);
    expect(lots(sinus(0.8, 2)).map((l) => d.push(l)).some(Boolean)).toBe(false);
  });

  it('alerte sur un signal écrêté, puis retombe quand le niveau baisse', () => {
    const d = new DetecteurSaturation(SR_S);
    const etats = lots(sinus(3, 1)).map((l) => d.push(l));
    // Moins d'une demi-seconde pour s'en apercevoir.
    expect(etats.indexOf(true)).toBeGreaterThanOrEqual(0);
    expect(etats.indexOf(true) * 512).toBeLessThan(SR_S / 2);
    const apres = lots(sinus(0.5, 2)).map((l) => d.push(l));
    expect(apres.at(-1)).toBe(false);
  });

  it('ne clignote pas entre deux attaques saturées', () => {
    // Une note écrêtée par seconde, comme sur les prises réelles : l'alerte
    // doit tenir entre les notes, pas s'éteindre dans chaque creux.
    const d = new DetecteurSaturation(SR_S);
    const signal = new Float32Array(SR_S * 4);
    for (let n = 0; n < 4; n += 1) {
      for (let i = 0; i < SR_S; i += 1) {
        signal[n * SR_S + i] = Math.max(-1, Math.min(1, 3 * Math.exp(-i / 4800) * Math.sin((2 * Math.PI * 110 * i) / SR_S)));
      }
    }
    const etats = lots(signal).map((l) => d.push(l));
    const premiere = etats.indexOf(true);
    expect(premiere).toBeGreaterThanOrEqual(0);
    expect(etats.slice(premiere).every(Boolean)).toBe(true);
  });
});
