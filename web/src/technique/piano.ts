/** Échantillons de piano pour la lecture d'un arpège ou d'une gamme (bouton
 * « Écouter » de l'écran Technique).
 *
 * Dix-sept notes seulement (une tierce mineure d'écart, `C2` à `C6` —
 * voir `web/public/data/piano/README.md`), pas les 88 touches : les hauteurs
 * intermédiaires sont obtenues par `playbackRate`, un écart d'au plus 1,5
 * demi-ton étant imperceptible sur un piano. Chargement paresseux : rien
 * n'est téléchargé tant que l'écran Technique n'a pas déclenché une lecture,
 * pour ne pas imposer ces ~3 Mo à qui n'ouvre jamais cette section.
 */

interface PianoSample {
  midi: number;
  file: string;
}

/** `octave = C4 = MIDI 60`, comme `theorie.ts`. Dièse = suffixe `s` (nommage
 * des fichiers sources, pas de bémol dans ce jeu d'échantillons). */
const SAMPLES: readonly PianoSample[] = [
  { midi: 36, file: 'C2.mp3' },
  { midi: 39, file: 'Ds2.mp3' },
  { midi: 42, file: 'Fs2.mp3' },
  { midi: 45, file: 'A2.mp3' },
  { midi: 48, file: 'C3.mp3' },
  { midi: 51, file: 'Ds3.mp3' },
  { midi: 54, file: 'Fs3.mp3' },
  { midi: 57, file: 'A3.mp3' },
  { midi: 60, file: 'C4.mp3' },
  { midi: 63, file: 'Ds4.mp3' },
  { midi: 66, file: 'Fs4.mp3' },
  { midi: 69, file: 'A4.mp3' },
  { midi: 72, file: 'C5.mp3' },
  { midi: 75, file: 'Ds5.mp3' },
  { midi: 78, file: 'Fs5.mp3' },
  { midi: 81, file: 'A5.mp3' },
  { midi: 84, file: 'C6.mp3' },
];

/** Échantillon le plus proche d'une hauteur MIDI donnée. */
function nearestSample(midi: number): PianoSample {
  let best = SAMPLES[0]!;
  let bestDistance = Math.abs(midi - best.midi);
  for (const sample of SAMPLES) {
    const distance = Math.abs(midi - sample.midi);
    if (distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }
  return best;
}

let buffersPromise: Promise<Map<number, AudioBuffer>> | null = null;

/** Télécharge et décode les échantillons, une seule fois, en cache. */
export function loadPianoSamples(context: AudioContext): Promise<Map<number, AudioBuffer>> {
  buffersPromise ??= Promise.all(
    SAMPLES.map(async (sample): Promise<readonly [number, AudioBuffer]> => {
      const response = await fetch(`data/piano/${sample.file}`);
      const bytes = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(bytes);
      return [sample.midi, buffer] as const;
    }),
  ).then((entries) => new Map(entries));
  return buffersPromise;
}

/** L'échantillon à jouer pour `midi`, et la vitesse de lecture qui l'y transpose. */
export function sampleFor(
  midi: number,
  buffers: Map<number, AudioBuffer>,
): { buffer: AudioBuffer; playbackRate: number } {
  const sample = nearestSample(midi);
  const buffer = buffers.get(sample.midi);
  if (!buffer) {
    // Ne peut pas arriver : `buffers` est toujours construit à partir de SAMPLES.
    throw new Error(`Échantillon de piano manquant pour MIDI ${sample.midi}.`);
  }
  return { buffer, playbackRate: 2 ** ((midi - sample.midi) / 12) };
}
