"""Détection automatique du tempo (BPM) d'un fichier audio (#111).

Une seule valeur pour tout le morceau (pas de courbe temporelle) : suffisant
pour un affichage de tempo, la variation réelle d'un enregistrement joué
reste hors scope. `librosa` est une dépendance lourde et n'est utile qu'ici :
importée localement, pour ne jamais peser sur les autres scripts du
pipeline (`preprocess_all.py` notamment) si elle n'est pas installée.
"""

from __future__ import annotations

from pathlib import Path

# Cadence pour laquelle `librosa.beat.beat_track` est calibré ; deux fois
# moins d'échantillons à analyser que le 48 kHz des fichiers encodés.
ANALYSIS_SR = 22050

# `beat_track` estime le tempo par autocorrélation sur l'enveloppe d'onset,
# à une résolution en BPM qui dépend directement de ce hop : avec la valeur
# par défaut (512), le résultat est quantifié sur une grille grossière (pas
# de ~5 BPM aux tempos de choro), au point que des morceaux sans rapport se
# retrouvent avec un BPM identique au dixième près. Le diviser par deux
# double la résolution de cette grille pour un coût de calcul négligeable
# ici (fichiers courts, script exécuté une fois par bande).
BEAT_TRACK_HOP_LENGTH = 256


def detect_bpm(path: Path) -> float | None:
    """Tempo global estimé en BPM, ou `None` si l'analyse échoue."""
    try:
        import librosa
        import numpy as np
    except ImportError:
        return None
    try:
        y, sr = librosa.load(str(path), sr=ANALYSIS_SR, mono=True)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr, hop_length=BEAT_TRACK_HOP_LENGTH)
        # `tempo` est un tableau numpy (une valeur) selon la version de
        # librosa ; `float(tempo)` seul émettrait un DeprecationWarning.
        bpm = float(np.atleast_1d(tempo)[0])
    except Exception:
        return None
    if not bpm or bpm <= 0:
        return None
    return round(bpm, 1)
