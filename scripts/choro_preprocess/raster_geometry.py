"""Moteur de repli : détection par morphologie mathématique OpenCV.

Ce pipeline n'est utilisé que si l'extraction vectorielle ne trouve aucune
portée — typiquement une partition scannée, ou un PDF dont les traits sont
encapsulés dans une image bitmap. Il travaille en pixels ; `measures.py`
normalisant par la taille de page, les coordonnées restent cohérentes.

Le redressement est ici indispensable : sur un scan, des portées même
légèrement inclinées ou gondolées (numérisation d'un livre relié) font
échouer les projections en lignes et en colonnes.
"""

from __future__ import annotations

import warnings

import cv2
import numpy as np

from .measures import PageGeometry, Staff, build_levels, group_staves

MAX_SKEW_DEGREES = 15.0  # plage d'angles explorée par la transformée de Hough
LEVEL_TOLERANCE = 3.0  # en pixels : deux bandes voisines = même ligne (marge à la
# légère ondulation résiduelle qu'un redressement par bandes ne gomme pas tout à fait)
STAFF_LINE_COVERAGE = 0.25  # part de la largeur devant être encrée
BARLINE_COVERAGE = 0.85  # part de la hauteur de portée devant être encrée

# --- Redressement local (gondolage) -----------------------------------------
# Un simple angle global (voir `detect_skew`/`deskew` ci-dessous) redresse une
# page scannée bien à plat, mais pas une page de livre relié : chaque portée
# suit alors sa propre courbe, souvent concentrée près d'un bord (la page qui
# plonge vers la reliure ou se relève en bord de feuille). Un modèle global
# (parabole, polynôme) lisse précisément cette courbure-là. On suit donc chaque
# ligne de portée colonne par colonne jusqu'à ses extrémités, et le champ de
# correction interpole, colonne par colonne, entre les lignes suivies.
LINE_KERNEL_DIVISOR = 120  # noyau d'ouverture court : survit à la courbure locale
SEED_COLUMNS = (0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9)  # bandes verticales (part de la
# largeur) où amorcer le suivi : plusieurs, pour attraper aussi une portée coupée en tronçons
SEED_ROW_COVERAGE = 0.5  # part de la bande qu'une ligne de portée doit encrer pour servir d'amorce
MIN_TRACK_COVERAGE = 0.25  # part de la largeur où une ligne suivie doit avoir été vue
TRACK_WINDOW = 3  # demi-fenêtre verticale (px) de recherche autour de la position prédite
SLOPE_SPAN = 40  # nombre de colonnes confirmées servant à estimer la pente locale
MAX_GAP_RATIO = 0.06  # interruption tolérée (part de la largeur) avant d'arrêter le suivi
SMOOTH_SPAN = 41  # lissage (px) du déplacement consensuel de chaque bande
BAND_GAP_RATIO = 0.025  # part de la hauteur de page séparant deux bandes de lignes
MIN_LINES_PER_BAND = 3  # une bande plus maigre n'est pas une portée (titre, texte souligné…)


def _binarise(gray: np.ndarray) -> np.ndarray:
    """Binarisation Otsu inversée : l'encre devient blanche (255)."""
    _, binary = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )
    return binary


def detect_skew(binary: np.ndarray) -> float:
    """Angle d'inclinaison médian, en degrés, via `cv2.HoughLinesP`.

    On ne retient que les segments quasi horizontaux (-15° à +15°) : ce sont
    les lignes de portée, de très loin les plus longs traits d'une partition.
    """
    height, width = binary.shape
    lines = cv2.HoughLinesP(
        binary,
        rho=1,
        theta=np.pi / 720.0,
        threshold=max(80, width // 8),
        minLineLength=width // 4,
        maxLineGap=width // 40,
    )
    if lines is None:
        return 0.0

    angles: list[float] = []
    # OpenCV < 5 renvoie (N, 1, 4), OpenCV 5 renvoie (N, 4) : on aplatit.
    for x0, y0, x1, y1 in np.asarray(lines).reshape(-1, 4):
        if x1 == x0:
            continue
        angle = np.degrees(np.arctan2(float(y1 - y0), float(x1 - x0)))
        if abs(angle) <= MAX_SKEW_DEGREES:
            angles.append(angle)
    if not angles:
        return 0.0
    return float(np.median(angles))


def deskew(image: np.ndarray, angle: float) -> np.ndarray:
    """Rotation affine inverse autour du centre, fond blanc."""
    if abs(angle) < 0.05:
        return image
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2.0, height / 2.0), angle, 1.0)
    border = 255 if image.ndim == 2 else (255, 255, 255)
    return cv2.warpAffine(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=border,
    )


def _line_thickness(opened: np.ndarray) -> int:
    """Épaisseur typique (px) d'une ligne de portée : longueur médiane des
    plages verticales encrées dans l'image réduite aux traits horizontaux."""
    column = opened[:, :: max(1, opened.shape[1] // 200)] > 0
    lengths: list[int] = []
    for x in range(column.shape[1]):
        lengths.extend(end - start for start, end in _runs(column[:, x]))
    return int(np.median(lengths)) if lengths else 2


def _seed_traces(binary: np.ndarray) -> tuple[list[np.ndarray], int]:
    """Lignes de portée suivies sur toute leur longueur, une trace y(x) chacune.

    Amorçage : dans quelques bandes verticales étroites (`SEED_COLUMNS`), une
    projection horizontale de l'image réduite aux traits horizontaux repère
    les lignes de portée — sur une bande étroite, même une ligne gondolée est
    quasi droite. On ne passe pas par les composantes connexes : ligatures et
    têtes de notes soudent souvent les cinq lignes d'une portée en un seul
    bloc. Chaque amorce est ensuite prolongée des deux côtés par `_track` ;
    une trace confirmée sur trop peu de colonnes (ligature, texte) est écartée.
    Retourne les traces (vecteurs indexés par x, `nan` hors de la ligne) et
    l'épaisseur typique d'une ligne.
    """
    height, width = binary.shape
    kernel_width = max(15, width // LINE_KERNEL_DIVISOR)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_width, 1))
    opened = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    thickness = _line_thickness(opened)
    max_run = 2 * thickness + 1
    half = max(8, width // 160)  # bande étroite : une ligne inclinée y reste quasi horizontale

    traces: list[np.ndarray] = []
    for ratio in SEED_COLUMNS:
        x_seed = int(width * ratio)
        strip = opened[:, max(0, x_seed - half) : x_seed + half] > 0
        rows = strip.mean(axis=1) >= SEED_ROW_COVERAGE
        for start, end in _runs(rows):
            if end - start > max_run:
                continue  # ligature, ou plusieurs lignes confondues
            y_seed = (start + end - 1) / 2.0
            if any(
                not np.isnan(t[x_seed]) and abs(t[x_seed] - y_seed) <= max_run
                for t in traces
            ):
                continue  # ligne déjà suivie depuis une autre amorce
            trace = np.full(width, np.nan)
            trace[x_seed] = y_seed
            confirmed = _track(binary, trace, thickness, +1)
            confirmed += _track(binary, trace, thickness, -1)
            if confirmed >= width * MIN_TRACK_COVERAGE:
                traces.append(trace)
    return traces, thickness


def _track(binary: np.ndarray, trace: np.ndarray, thickness: int, step: int) -> int:
    """Prolonge `trace` (en place) dans le sens `step` (+1 ou -1) sur l'image brute.

    À chaque colonne, on prédit la position de la ligne d'après sa pente
    locale et on cherche, dans une petite fenêtre, une plage encrée de
    l'épaisseur d'une ligne de portée. Une plage trop épaisse (tête de note,
    ligature, barre) ou absente est une interruption : on continue sur la
    prédiction, et on s'arrête — en effaçant les colonnes seulement prédites —
    quand l'interruption dure trop, c'est-à-dire en bout de portée. Retourne
    le nombre de colonnes où la ligne a effectivement été vue.
    """
    height, width = binary.shape
    valid = np.flatnonzero(~np.isnan(trace))
    if valid.size == 0:
        return 0
    confirmed_x = [int(valid[-1] if step > 0 else valid[0])]
    confirmed_y = [float(trace[confirmed_x[0]])]
    max_gap = max(10, int(width * MAX_GAP_RATIO))
    max_run = 2 * thickness + 1

    x = confirmed_x[-1]
    gap = 0
    slope = 0.0
    predicted: list[int] = []
    while 0 <= x + step < width and gap <= max_gap:
        x += step
        # Pente réestimée périodiquement sur les dernières colonnes confirmées.
        if len(confirmed_x) >= 5 and x % 8 == 0:
            xs = np.asarray(confirmed_x[-SLOPE_SPAN:], dtype=float)
            ys = np.asarray(confirmed_y[-SLOPE_SPAN:], dtype=float)
            if np.ptp(xs) > 0:
                slope = float(np.polyfit(xs, ys, 1)[0])
        guess = confirmed_y[-1] + slope * (x - confirmed_x[-1])

        lo = int(max(0, np.floor(guess) - TRACK_WINDOW - max_run))
        hi = int(min(height, np.ceil(guess) + TRACK_WINDOW + max_run + 1))
        best = None
        for start, end in _runs(binary[lo:hi, x] > 0):
            centre = lo + (start + end - 1) / 2.0
            if end - start <= max_run and abs(centre - guess) <= TRACK_WINDOW:
                if best is None or abs(centre - guess) < abs(best - guess):
                    best = centre
        if best is None:
            gap += 1
            predicted.append(x)
            trace[x] = guess
            continue
        gap = 0
        predicted.clear()
        trace[x] = best
        confirmed_x.append(x)
        confirmed_y.append(best)
    for x in predicted:
        trace[x] = np.nan
    return len(confirmed_x) - 1


def _band_consensus(stack: np.ndarray) -> np.ndarray:
    """Médiane par colonne des déplacements d'une bande, `nan` là où moins de
    la moitié de ses lignes est suivie (pas assez fiable)."""
    present = (~np.isnan(stack)).sum(axis=0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        consensus = np.nanmedian(stack, axis=0)
    consensus[present * 2 < stack.shape[0]] = np.nan
    return consensus


def _smooth(values: np.ndarray, span: int) -> np.ndarray:
    """Moyenne glissante qui ignore les `nan` (et les conserve)."""
    mask = ~np.isnan(values)
    filled = np.where(mask, values, 0.0)
    kernel = np.ones(span) / span
    total = np.convolve(filled, kernel, mode="same")
    weight = np.convolve(mask.astype(float), kernel, mode="same")
    out = np.full_like(values, np.nan)
    out[mask] = total[mask] / weight[mask]
    return out


def estimate_warp(gray: np.ndarray) -> np.ndarray | None:
    """Champ de correction verticale (une valeur par pixel), ou `None`.

    Chaque ligne de portée suivie (`_seed_traces`) donne, par
    colonne, son écart à sa propre hauteur de référence (la médiane de sa
    trace) : c'est le déplacement qu'il faut annuler. Les lignes d'une même
    bande (une portée) votent pour un déplacement commun ; colonne par
    colonne, on interpole ensuite entre bandes selon leur hauteur, en
    prolongeant la plus proche au-dessus de la première et sous la dernière.
    `None` quand la page est trop pauvre en lignes pour être fiable — le
    simple angle global (`detect_skew`/`deskew`) prend alors le relais.
    """
    height, width = gray.shape
    binary = _binarise(gray)
    traces, thickness = _seed_traces(binary)
    if len(traces) < MIN_LINES_PER_BAND:
        return None

    anchors = [float(np.nanmedian(trace)) for trace in traces]

    # Consensus par bande : les lignes voisines (une portée, un système)
    # partagent le même gondolage physique. La médiane colonne par colonne de
    # leurs déplacements écarte la ligne qui, localement, a décroché sur une
    # liaison ou une ligature. Deux bandes séparées par un grand vide (deux
    # systèmes) restent indépendantes.
    order = np.argsort(anchors)
    gap = height * BAND_GAP_RATIO
    bands: list[list[int]] = []
    for idx in order:
        if bands and anchors[idx] - anchors[bands[-1][-1]] <= gap:
            bands[-1].append(idx)
        else:
            bands.append([idx])

    anchor_list: list[float] = []
    shift_list: list[np.ndarray] = []
    columns = np.arange(width)
    for band in bands:
        if len(band) < MIN_LINES_PER_BAND:
            continue
        lines = np.stack([traces[idx] for idx in band])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            levels = np.nanmedian(lines, axis=1)
        keep = np.ones(len(band), dtype=bool)
        curve = None
        # Deux passes : la hauteur d'une ligne suivie sur une partie seulement
        # de la largeur est biaisée par la courbure si on la prend comme sa
        # simple médiane ; on la mesure donc par rapport à la courbe commune de
        # la bande, ce qui garde les lignes d'une portée régulièrement espacées.
        for _ in range(2):
            consensus = _band_consensus(lines[keep] - levels[keep, None])
            valid = np.flatnonzero(~np.isnan(consensus))
            if valid.size == 0:
                curve = None
                break
            # Comble les interruptions internes et prolonge à plat au-delà des
            # extrémités : chaque bande couvre ainsi toute la largeur, et les
            # marges suivent le bord de la portée au lieu d'une autre bande.
            curve = np.interp(columns, valid, consensus[valid])
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                levels = np.nanmedian(lines - curve, axis=1)
                # Une ligne qui s'écarte nettement de la courbe commune a été
                # mal amorcée (deux lignes confondues, une ligature) : écartée.
                spread = np.nanmedian(np.abs(lines - levels[:, None] - curve), axis=1)
            keep = spread <= thickness
            if keep.sum() < MIN_LINES_PER_BAND:
                curve = None
                break
        if curve is None:
            continue
        reference = float(np.median(curve))
        # Le gondolage étire aussi la page verticalement : les lignes d'une
        # même portée ne bougent pas tout à fait d'un bloc. Chaque ligne garde
        # donc son propre écart à la courbe commune, écrêté là où elle a décroché.
        for line, level in zip(lines[keep], levels[keep]):
            residual = line - level - curve
            residual[np.abs(residual) > thickness] = np.nan
            seen = np.flatnonzero(~np.isnan(residual))
            if seen.size < width * MIN_TRACK_COVERAGE / 2:
                continue
            residual = np.interp(columns, seen, residual[seen])
            anchor_list.append(float(level) + reference)
            shift_list.append(_smooth(curve - reference + residual, SMOOTH_SPAN))
    if not anchor_list:
        return None
    order = np.argsort(anchor_list)
    anchor_arr = np.asarray(anchor_list)[order]
    shift_arr = np.stack(shift_list)[order]  # (lignes, colonnes)

    rows = np.arange(height, dtype=float)
    offsets = np.empty((height, width), dtype=np.float32)
    for x in range(width):
        offsets[:, x] = np.interp(rows, anchor_arr, shift_arr[:, x])
    return offsets


def dewarp(image: np.ndarray, offsets: np.ndarray) -> np.ndarray:
    """Applique le champ de correction verticale de `estimate_warp`."""
    height, width = image.shape[:2]
    map_x, map_y = np.meshgrid(
        np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32)
    )
    border = 255 if image.ndim == 2 else (255, 255, 255)
    return cv2.remap(
        image,
        map_x,
        map_y + offsets,
        interpolation=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=border,
    )


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Intervalles [start, end) des zones vraies d'un masque booléen 1D."""
    if not mask.any():
        return []
    padded = np.concatenate(([False], mask, [False]))
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    return list(zip(edges[0::2].tolist(), edges[1::2].tolist()))


def _staff_levels(binary: np.ndarray) -> list:
    """Extrait les lignes de portée via une ouverture à noyau horizontal large."""
    height, width = binary.shape
    kernel_width = max(15, width // 30)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_width, 1))
    lines_only = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    row_ink = (lines_only > 0).sum(axis=1)
    rows = row_ink >= width * STAFF_LINE_COVERAGE

    horizontals: list[tuple[float, float, float]] = []
    for y_start, y_end in _runs(rows):
        band = lines_only[y_start:y_end]
        columns = np.flatnonzero((band > 0).any(axis=0))
        if columns.size == 0:
            continue
        horizontals.append(
            ((y_start + y_end - 1) / 2.0, float(columns[0]), float(columns[-1] + 1))
        )

    return build_levels(horizontals, float(width), LEVEL_TOLERANCE)


def _group_staves_tolerant(levels: list) -> list[Staff]:
    """`group_staves`, en tolérant un niveau parasite au milieu d'une portée.

    Sur un scan, il reste parfois un niveau en trop entre deux lignes d'une
    même portée : une ligne coupée en deux tronçons légèrement décalés, un
    trait de texte ou de liaison assez long. Le balayage glouton de
    `group_staves` rate alors toute la portée. Quand la fenêtre de 5 niveaux
    n'est pas une portée, on essaie donc aussi les 6 niveaux suivants privés
    de l'un d'eux. Réservé au repli raster : le moteur vectoriel garde le
    balayage strict.
    """
    staves: list[Staff] = []
    i = 0
    while i + 4 < len(levels):
        found = group_staves(levels[i : i + 5])
        consumed = 5
        if not found and i + 5 < len(levels):
            for skip in range(1, 5):
                window = levels[i : i + skip] + levels[i + skip + 1 : i + 6]
                found = group_staves(window)
                if found:
                    consumed = 6
                    break
        if found:
            staves.extend(found)
            i += consumed
        else:
            i += 1
    return staves


def _detect_barlines(binary: np.ndarray, staff: Staff) -> list[float]:
    """Barres de mesure : colonnes encrées sur toute la hauteur de la portée."""
    y_top, y_bottom = int(round(staff.y_top)), int(round(staff.y_bottom))
    band = binary[y_top : y_bottom + 1]
    if band.size == 0:
        return []

    staff_height = band.shape[0]
    kernel_height = max(3, int(staff_height * 0.9))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, kernel_height))
    verticals = cv2.morphologyEx(band, cv2.MORPH_OPEN, kernel)

    column_ink = (verticals > 0).sum(axis=0)
    columns = column_ink >= staff_height * BARLINE_COVERAGE
    return [(a + b - 1) / 2.0 for a, b in _runs(columns)]


def analyse(gray: np.ndarray) -> tuple[PageGeometry, np.ndarray, float]:
    """Redresse l'image puis détecte portées et barres.

    Le redressement local, ligne par ligne (`estimate_warp`/`dewarp`), traite aussi
    bien un gondolage que la simple rotation dont il est un sur-ensemble, mais
    reste un ajustement statistique : sur une page déjà quasiment plate, il
    peut l'ajuster légèrement dans le mauvais sens. On calcule donc les deux
    candidats (angle global, et redressement local le cas échéant) et on
    retient celui qui fait effectivement trouver le plus de portées — le
    signal qui compte réellement pour la suite du pipeline.

    Retourne la géométrie, l'image redressée (celle qu'il faut enregistrer,
    pour que les boîtes correspondent au pixel près) et l'amplitude de la
    correction retenue (en pixels, écart max au repère local — plus parlant
    qu'un angle unique une fois le gondolage pris en compte).
    """
    angle = detect_skew(_binarise(gray))
    global_straight = deskew(gray, angle)
    global_binary = _binarise(global_straight)
    candidates = [
        (abs(angle), global_straight, global_binary, _group_staves_tolerant(_staff_levels(global_binary)))
    ]

    offsets = estimate_warp(gray)
    if offsets is not None:
        local_straight = dewarp(gray, offsets)
        local_binary = _binarise(local_straight)
        candidates.append(
            (
                float(np.abs(offsets).max()),
                local_straight,
                local_binary,
                _group_staves_tolerant(_staff_levels(local_binary)),
            )
        )

    correction, straight, binary, staves = max(candidates, key=lambda c: len(c[3]))

    for staff in staves:
        found = list(staff.barlines) + _detect_barlines(binary, staff)
        staff.barlines = sorted(x for x in found if staff.x_left < x < staff.x_right)

    height, width = straight.shape[:2]
    geometry = PageGeometry(
        width=float(width), height=float(height), staves=staves, source="raster"
    )
    return geometry, straight, correction
