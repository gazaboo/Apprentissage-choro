"""Découpage automatique d'une bande audio en parties A / B / C.

Le choro a une forme connue d'avance : la grille d'accords du morceau
(`data/grilles/<id>.json`) dit combien de mesures fait chaque partie et quels
accords y sont joués. Plutôt que de deviner la structure à l'aveugle, on
*aligne* donc l'enregistrement sur la grille :

1. temps de l'enregistrement (`librosa.beat.beat_track`), puis un chroma
   (poids des 12 classes de hauteur) par temps ;
2. pour chaque temps de chaque partie de la grille, un chroma théorique
   tiré des accords écrits ;
3. décodage de Viterbi : chaque partie est une chaîne d'états (un par temps),
   la fin d'une partie peut enchaîner sur le début de n'importe quelle autre,
   et des états « hors grille » absorbent silence initial, chorus improvisé,
   applaudissements. Seules contraintes : l'intro ouvre, la coda ferme.

Aucune hypothèse sur l'ordre des parties : un enregistrement qui saute une
reprise ou improvise un chorus reste décodable. La tonalité de
l'enregistrement n'est pas supposée égale à celle de la grille : les douze
transpositions sont essayées, la meilleure l'emporte.

La logique d'alignement (`parse_chord`, `build_units`, `align`) ne dépend que
de numpy, et se teste sur des chromas synthétiques ; seule `analyze_audio`
importe librosa, localement, comme `tempo.py`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

# Intervalles (en demi-tons depuis la fondamentale) des qualités d'accord
# rencontrées dans les grilles. Une qualité inconnue retombe sur
# `_guess_intervals`, qui lit juste « mineur ? » et « septième ? ».
QUALITY_INTERVALS: dict[str, tuple[int, ...]] = {
    "": (0, 4, 7),
    "m": (0, 3, 7),
    "7": (0, 4, 7, 10),
    "m7": (0, 3, 7, 10),
    "maj7": (0, 4, 7, 11),
    "6": (0, 4, 7, 9),
    "m6": (0, 3, 7, 9),
    "dim": (0, 3, 6, 9),
    "dim7": (0, 3, 6, 9),
    "m7b5": (0, 3, 6, 10),
    "m(maj7)": (0, 3, 7, 11),
    "aug": (0, 4, 8),
    "(#5)": (0, 4, 8),
    "7#5": (0, 4, 8, 10),
    "9": (0, 4, 7, 10, 2),
    "7add9": (0, 4, 7, 10, 2),
}

CHORD_RE = re.compile(r"^([A-G][#b]?)(.*?)(?:/([A-G][#b]?))?$")

# Poids des notes dans un gabarit : la fondamentale et la basse ressortent
# nettement dans un chroma d'enregistrement (7 cordes, contrebasse), les
# notes de couleur (7e, 6te) moins.
ROOT_WEIGHT = 1.0
TONE_WEIGHT = 0.8
BASS_WEIGHT = 0.5

# Label des états qui ne correspondent à aucune partie écrite.
FREE = None


def pitch_class(name: str) -> int:
    pc = NOTE_PC[name[0]]
    for accidental in name[1:]:
        pc += 1 if accidental == "#" else -1
    return pc % 12


def _guess_intervals(quality: str) -> tuple[int, ...]:
    minor = quality.startswith("m") and not quality.startswith("maj")
    third = 3 if minor else 4
    fifth = 6 if "b5" in quality or "dim" in quality else 7
    tones = [0, third, fifth]
    if "7" in quality:
        tones.append(11 if "maj" in quality else 10)
    return tuple(tones)


def parse_chord(symbol: str) -> tuple[int, tuple[int, ...], int | None] | None:
    """`'A7/C#'` → (9, (0, 4, 7, 10), 1) ; `None` si le symbole est illisible."""
    match = CHORD_RE.match(symbol.replace(" ", ""))
    if not match:
        return None
    root_name, quality, bass_name = match.groups()
    intervals = QUALITY_INTERVALS.get(quality) or _guess_intervals(quality)
    bass = pitch_class(bass_name) if bass_name else None
    return pitch_class(root_name), intervals, bass


def chord_template(symbol: str) -> np.ndarray | None:
    parsed = parse_chord(symbol)
    if parsed is None:
        return None
    root, intervals, bass = parsed
    template = np.zeros(12)
    for interval in intervals:
        template[(root + interval) % 12] = TONE_WEIGHT
    template[root] = ROOT_WEIGHT
    if bass is not None:
        template[bass] += BASS_WEIGHT
    return template


def _normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=0, keepdims=True)
    return matrix / np.where(norms > 0, norms, 1.0)


@dataclass
class Unit:
    """Un bloc joué d'un seul tenant : une passe d'une partie, une intro, une coda."""

    label: str
    cells: list[list[str]]

    @property
    def role(self) -> str:
        """« intro », « coda » ou « part » : l'intro et la coda ont leur place imposée."""
        name = self.label.strip().lower()
        if name.startswith("intro"):
            return "intro"
        if name.startswith("coda"):
            return "coda"
        return "part"


def build_units(grille: dict) -> list[Unit]:
    """Blocs alignables d'une grille, sans doublon.

    Une partie avec reprise et deux fins donne deux blocs (séquence + 1re fin,
    séquence + 2e fin) ; des fins identiques n'en donnent qu'un. Les mesures
    d'enchaînement (`transition_in`) précèdent la partie. La coda propre à une
    partie et celle du morceau deviennent des blocs « Coda ».
    """
    units: list[Unit] = []
    seen: set[tuple[str, str]] = set()

    def add(label: str, cells: list[list[str]]) -> None:
        cells = [list(cell) for cell in cells]
        key = (label, repr(cells))
        if len(cells) >= MIN_UNIT_MEASURES and key not in seen:
            seen.add(key)
            units.append(Unit(label, cells))

    for part in grille.get("parts") or []:
        label = str(part.get("name") or "?")
        sequence = list(part.get("sequence") or [])
        endings = part.get("endings") or {}
        lead_in = list(part.get("transition_in") or [])
        passes = [endings[key] for key in ("1", "2") if endings.get(key)] or [[]]
        for ending in passes:
            add(label, sequence + list(ending))
        if lead_in:
            add(label, lead_in + sequence + list(passes[0]))
        if part.get("coda"):
            add("Coda", part["coda"])
    if grille.get("coda"):
        add("Coda", grille["coda"])
    return units


def unit_templates(unit: Unit, beats_per_measure: int) -> np.ndarray:
    """Gabarits chroma (12 × temps) d'un bloc, un par temps écrit.

    Une mesure à *n* accords est découpée en *n* parts égales ; chaque temps
    reçoit la moyenne des accords qui le recouvrent. Une cellule vide tient
    l'accord précédent, comme dans la grille affichée.
    """
    columns: list[np.ndarray] = []
    previous: list[np.ndarray] = [np.full(12, 1.0)]
    for cell in unit.cells:
        chords = [t for t in (chord_template(symbol) for symbol in cell) if t is not None]
        if not chords:
            chords = previous[-1:]
        previous = chords
        n = len(chords)
        for beat in range(beats_per_measure):
            lo, hi = beat / beats_per_measure, (beat + 1) / beats_per_measure
            column = np.zeros(12)
            for i, template in enumerate(chords):
                overlap = min(hi, (i + 1) / n) - max(lo, i / n)
                if overlap > 0:
                    column += overlap * template
            columns.append(column)
    return _normalize(np.stack(columns, axis=1))


# La battue détectée n'est pas toujours la noire : la rythmique du choro
# (3 + 3 + 2 doubles) pousse souvent `beat_track` vers le double ou vers une
# pulsation aux ¾ du tempo. Plutôt que de corriger la battue, on essaie
# plusieurs densités de temps par mesure écrite et on garde la meilleure ; les
# transitions « tenir » et « sauter » absorbent les rapports non entiers.
BEATS_PER_MEASURE_OPTIONS = (1, 2, 3, 4)

# Un bloc plus court (coda d'une mesure, pont) ne sert pas de repère et
# devient un bouche-trou commode pour le décodage : on le laisse à l'état
# « hors grille ».
MIN_UNIT_MEASURES = 4


@dataclass
class AlignParams:
    # Échelle des scores de similarité (cosinus ∈ [0, 1]) : plus elle est
    # grande, plus le chroma pèse face aux pénalités de transition.
    sharpness: float = 12.0
    # Similarité en dessous de laquelle l'état « hors grille » gagne.
    free_threshold: float = 0.55
    # Pénalités (log) des écarts au déroulé strict temps par temps : tenir un
    # temps (enregistrement plus lent / battue trop fine), sauter un temps,
    # sauter une mesure entière (grille à une mesure près).
    stay: float = 4.0
    skip_beat: float = 4.0
    skip_measure: float = 8.0
    # Enchaîner deux blocs, entrer / sortir de l'état « hors grille ».
    switch: float = 3.0
    free_switch: float = 6.0


@dataclass
class Alignment:
    # Pour chaque temps : index du bloc (ou -1 hors grille) et position dans le bloc.
    unit_of: np.ndarray
    pos_of: np.ndarray
    score: float
    shift: int
    beats_per_measure: int
    # Similarité (cosinus) de chaque temps avec le gabarit retenu (NaN hors
    # grille), et avec la moyenne de tous les gabarits — le niveau « au hasard ».
    similarity: np.ndarray
    chance: np.ndarray


# États « hors grille », placés après ceux des blocs : avant le premier bloc
# (silence, décompte), entre deux blocs (chorus improvisé, pont non écrit),
# après la fin (applaudissements, fondu). Les séparer permet d'interdire
# une intro en plein morceau ou une reprise après la coda.
LEAD, MID, TAIL = range(3)
N_FREE = 3


def _graph(units: list[Unit], lengths: list[int], beats_per_measure: int, p: AlignParams):
    """Arêtes (src, dst, log-poids) du modèle, triées par cible, et loi initiale."""
    offsets = np.concatenate([[0], np.cumsum(lengths)]).astype(int)
    n_unit_states = int(offsets[-1])
    n_states = n_unit_states + N_FREE
    lead, mid, tail = (n_unit_states + i for i in (LEAD, MID, TAIL))
    starts = offsets[:-1]
    ends = offsets[1:] - 1
    src: list[int] = []
    dst: list[int] = []
    weight: list[float] = []

    def edge(a: int, b: int, w: float) -> None:
        src.append(int(a))
        dst.append(int(b))
        weight.append(-w)

    for start, end in zip(starts, ends):
        for s in range(start, end + 1):
            edge(s, s, p.stay)
            if s + 1 <= end:
                edge(s, s + 1, 0.0)
            if s + 2 <= end:
                edge(s, s + 2, p.skip_beat)
            if s + beats_per_measure + 1 <= end:
                edge(s, s + beats_per_measure + 1, p.skip_measure)

    # Une intro ne s'entend qu'en ouverture ; après une coda, plus rien.
    body = [int(start) for unit, start in zip(units, starts) if unit.role != "intro"]
    for unit, end in zip(units, ends):
        if unit.role == "coda":
            edge(end, tail, 0.0)
            continue
        for start in body:
            edge(end, start, p.switch)
        edge(end, mid, p.free_switch)
        edge(end, tail, p.free_switch)
    for start in starts:
        edge(lead, start, p.free_switch)
    for start in body:
        edge(mid, start, p.free_switch)
    for free in (lead, mid, tail):
        edge(free, free, 0.0)

    initial = np.full(n_states, -np.inf)
    initial[starts] = 0.0
    initial[lead] = 0.0
    order = np.lexsort((np.array(src), np.array(dst)))
    return np.array(src)[order], np.array(dst)[order], np.array(weight)[order], initial


def _viterbi(log_emit: np.ndarray, src, dst, weight, initial: np.ndarray):
    """Chemin le plus probable ; `log_emit` est (états × temps)."""
    n_states, n_steps = log_emit.shape
    group_starts = np.flatnonzero(np.r_[True, dst[1:] != dst[:-1]])
    targets = dst[group_starts]
    delta = initial + log_emit[:, 0]
    back = np.zeros((n_steps, n_states), dtype=np.int32)
    for t in range(1, n_steps):
        cand = delta[src] + weight
        best = np.maximum.reduceat(cand, group_starts)
        # Premier candidat atteignant le max dans chaque groupe de même cible.
        is_best = cand >= np.repeat(best, np.diff(np.r_[group_starts, len(cand)]))
        first = np.maximum.reduceat(
            np.where(is_best, -np.arange(len(cand)), -len(cand)), group_starts
        )
        new = np.full(n_states, -np.inf)
        new[targets] = best
        back[t, targets] = src[-first]
        delta = new + log_emit[:, t]
    path = np.empty(n_steps, dtype=np.int32)
    path[-1] = int(np.argmax(delta))
    for t in range(n_steps - 1, 0, -1):
        path[t - 1] = back[t, path[t]]
    return path, float(np.max(delta))


def align(
    chroma: np.ndarray,
    units: list[Unit],
    beats_per_measure: int | tuple[int, ...] = BEATS_PER_MEASURE_OPTIONS,
    params: AlignParams | None = None,
    shifts: range | list[int] = range(12),
) -> Alignment:
    """Aligne un chroma par temps (12 × temps) sur les blocs de la grille.

    Essaie chaque transposition de `shifts` et chaque nombre de temps détectés
    par mesure écrite, et garde la combinaison dont le chemin de Viterbi a le
    meilleur score.
    """
    options = (beats_per_measure,) if isinstance(beats_per_measure, int) else beats_per_measure
    best: Alignment | None = None
    for k in options:
        candidate = _align_fixed(chroma, units, k, params or AlignParams(), shifts)
        if best is None or candidate.score > best.score:
            best = candidate
    assert best is not None
    return best


def _align_fixed(chroma, units, beats_per_measure, p, shifts) -> Alignment:
    observed = _normalize(np.maximum(chroma, 0.0))
    templates = [unit_templates(unit, beats_per_measure) for unit in units]
    lengths = [t.shape[1] for t in templates]
    src, dst, weight, initial = _graph(units, lengths, beats_per_measure, p)
    stacked = np.concatenate(templates, axis=1)

    unit_index = np.concatenate([np.full(n, i) for i, n in enumerate(lengths)] + [np.full(N_FREE, -1)])
    position = np.concatenate([np.arange(n) for n in lengths] + [np.zeros(N_FREE, dtype=int)])

    best: Alignment | None = None
    for shift in shifts:
        similarity = np.roll(stacked, shift, axis=0).T @ observed
        log_emit = np.vstack(
            [p.sharpness * similarity, np.full((N_FREE, observed.shape[1]), p.sharpness * p.free_threshold)]
        )
        path, score = _viterbi(log_emit, src, dst, weight, initial)
        if best is None or score > best.score:
            matched = unit_index[path] >= 0
            on_path = np.where(
                matched, similarity[np.minimum(path, similarity.shape[0] - 1), np.arange(len(path))], np.nan
            )
            best = Alignment(
                unit_index[path],
                position[path],
                score,
                shift,
                beats_per_measure,
                on_path,
                similarity.mean(axis=0),
            )
    assert best is not None
    return best


def segments(alignment: Alignment, units: list[Unit]) -> list[tuple[str | None, int, int]]:
    """Découpe le chemin en passes contiguës : (label, 1er temps, temps de fin exclu).

    Une nouvelle passe commence à chaque changement de bloc, et aussi quand le
    chemin revient au début du même bloc (A puis A de nouveau).
    """
    out: list[tuple[str | None, int, int]] = []
    start = 0
    n = len(alignment.unit_of)
    for t in range(1, n + 1):
        boundary = t == n or alignment.unit_of[t] != alignment.unit_of[t - 1] or (
            alignment.unit_of[t] >= 0 and alignment.pos_of[t] < alignment.pos_of[t - 1]
        )
        if boundary:
            u = int(alignment.unit_of[start])
            out.append((units[u].label if u >= 0 else FREE, start, t))
            start = t
    return out


@dataclass
class AudioFeatures:
    beat_times: np.ndarray  # instants des temps, en secondes (n + 1 bornes)
    chroma: np.ndarray  # 12 × n, un vecteur par intervalle entre deux temps
    duration: float


ANALYSIS_SR = 22050
HOP_LENGTH = 512


def analyze_audio(path: Path, bpm: float | None = None) -> AudioFeatures:
    import librosa

    y, sr = librosa.load(str(path), sr=ANALYSIS_SR, mono=True)
    duration = len(y) / sr
    harmonic = librosa.effects.harmonic(y)
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)
    _, beats = librosa.beat.beat_track(
        onset_envelope=onset, sr=sr, hop_length=HOP_LENGTH, start_bpm=bpm or 110.0
    )
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sr, hop_length=HOP_LENGTH)
    beats = np.unique(np.clip(beats, 0, chroma.shape[1] - 1))
    synced = librosa.util.sync(chroma, beats, aggregate=np.mean, pad=False)
    times = librosa.frames_to_time(beats, sr=sr, hop_length=HOP_LENGTH)
    return AudioFeatures(beat_times=times, chroma=synced, duration=duration)


# Seuils de l'indice de confiance (voir `summarize`).
MIN_COVERAGE = 0.85
MAX_SAME_PART_RUN = 4


@dataclass
class Detection:
    """Résultat publiable : passes horodatées + de quoi juger leur fiabilité."""

    sections: list[dict]
    confidence: str  # « high » ou « low »
    coverage: float
    shift: int
    beats_per_measure: int


def summarize(alignment: Alignment, units: list[Unit], beat_times: np.ndarray) -> Detection:
    """Passes horodatées d'un alignement, et indice de confiance.

    `beat_times` a une borne de plus que le chroma : le temps *i* court de
    `beat_times[i]` à `beat_times[i + 1]`. Une passe qui ne couvre pas
    `MIN_UNIT_MEASURES` mesures de la grille (fin coupée par un fondu, raccord
    de deux blocs) est écartée : elle ne sert pas de repère.

    La confiance est « high » quand toutes les parties de la grille ont été
    reconnues au moins une fois, que l'essentiel de l'enregistrement est
    aligné et qu'aucune partie ne revient en boucle — le symptôme d'un
    alignement qui s'accroche à la seule partie à peu près ressemblante.
    """
    k = alignment.beats_per_measure
    sections: list[dict] = []
    for label, a, b in segments(alignment, units):
        if label is FREE:
            continue
        covered = (int(alignment.pos_of[b - 1]) - int(alignment.pos_of[a]) + 1) / k
        if covered < MIN_UNIT_MEASURES:
            continue
        sections.append(
            {"part": label, "start": round(float(beat_times[a]), 2), "end": round(float(beat_times[b]), 2)}
        )

    coverage = float(np.mean(alignment.unit_of >= 0)) if len(alignment.unit_of) else 0.0
    expected = {unit.label for unit in units if unit.role == "part"}
    found = {section["part"] for section in sections}
    longest_run, run = 0, 0
    for i, section in enumerate(sections):
        run = run + 1 if i and section["part"] == sections[i - 1]["part"] else 1
        longest_run = max(longest_run, run)
    reliable = expected <= found and coverage >= MIN_COVERAGE and longest_run <= MAX_SAME_PART_RUN
    return Detection(
        sections=sections,
        confidence="high" if reliable else "low",
        coverage=round(coverage, 3),
        shift=alignment.shift,
        beats_per_measure=k,
    )


def detect_sections(path: Path, grille: dict, bpm: float | None = None) -> Detection | None:
    """Découpe une bande selon sa grille ; `None` si l'analyse est impossible."""
    units = build_units(grille)
    if not units:
        return None
    try:
        features = analyze_audio(path, bpm)
    except ImportError:
        return None
    if features.chroma.shape[1] < 2:
        return None
    return summarize(align(features.chroma, units), units, features.beat_times)
