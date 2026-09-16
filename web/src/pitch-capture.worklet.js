/** Capture du micro, échantillon par échantillon, pour la détection de hauteur.
 *
 * Ce processeur ne décide rien : il recopie l'entrée par lots et dit à quel
 * instant chaque lot commence. Toute l'analyse — attaques, hauteurs — se fait
 * sur le fil principal, à partir de ces lots (voir `PitchStream` dans
 * `pitch.ts`).
 *
 * C'est le partage qui compte. Un `AnalyserNode` ne rend que les N derniers
 * échantillons *au moment où on l'interroge* : impossible d'obtenir la fenêtre
 * qui suit une attaque, puisqu'au moment où l'on sait qu'il y a eu une attaque,
 * la fenêtre la contient déjà à moitié. En sortant les échantillons d'ici, on
 * garde un flux continu dans lequel on découpe après coup exactement ce qu'on
 * veut — et l'index `frame`, qui accompagne chaque lot, date chaque échantillon
 * sur l'horloge de l'`AudioContext` sans dépendre du moment où le message est
 * reçu.
 *
 * Le calcul d'autocorrélation, lui, n'a rien à faire sur le fil audio : il est
 * en O(n²) et le ferait craquer. D'où ce processeur volontairement bête.
 */

/** ~11,6 ms à 44,1 kHz : assez court pour un VU-mètre vivant, assez long pour
 *  ne pas noyer le fil principal sous 344 messages par seconde. */
const BATCH = 512;

class PitchCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = new Float32Array(BATCH);
    this.filled = 0;
    this.startFrame = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    // Entrée pas encore prête : rester en vie, sans quoi le nœud serait
    // recyclé avant même que le micro n'ait commencé à débiter.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      // `currentFrame` est l'index du premier échantillon du bloc courant sur
      // l'horloge du contexte : `startFrame / sampleRate` est donc directement
      // un `AudioContext.currentTime`.
      if (this.filled === 0) this.startFrame = currentFrame + i;
      this.batch[this.filled] = channel[i];
      this.filled += 1;

      if (this.filled === BATCH) {
        // Transfert plutôt que copie : le tampon change de fil sans allocation
        // côté réception, d'où le `new Float32Array` qui suit.
        this.port.postMessage({ frame: this.startFrame, samples: this.batch }, [
          this.batch.buffer,
        ]);
        this.batch = new Float32Array(BATCH);
        this.filled = 0;
      }
    }

    return true;
  }
}

registerProcessor('pitch-capture', PitchCaptureProcessor);
