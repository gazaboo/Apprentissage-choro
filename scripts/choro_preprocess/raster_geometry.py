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
# page scannée bien à plat, mais pas une page de livre relié : chaque système
# suit alors sa propre courbe, différente d'un système à l'autre. On trace
# individuellement les traits quasi pleine largeur (lignes de portée), on les
# regroupe par bande verticale et on ajuste une courbe par bande ; le champ de
# correction final interpole entre bandes pour rester continu sur toute la page.
LINE_KERNEL_DIVISOR = 120  # noyau d'ouverture court : survit à la courbure locale
MIN_LINE_COVERAGE = 0.85  # part de la largeur qu'un trait de portée quasi entier doit couvrir
CURVE_POLY_DEGREE = 2  # suffisant pour un gondolage de page (parabole locale)
BAND_GAP_RATIO = 0.025  # part de la hauteur de page séparant deux bandes de traits
MIN_TRACES_FOR_WARP = 2  # bandes trop clairsemées : on retombe sur le simple angle global


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


def _line_traces(binary: np.ndarray) -> list[np.ndarray]:
    """Trace y(x) de chaque trait quasi pleine largeur (ligne de portée).

    Contrairement à `_staff_levels`, le noyau d'ouverture est court : il
    survit à une légère courbure locale au lieu d'exiger une ligne parfaitement
    droite sur toute sa longueur. Chaque composante connexe assez large est
    réduite à sa moyenne y par colonne — un vecteur indexé par x, `nan` où le
    trait est absent (interrompu par une barre de reprise, par exemple).
    """
    height, width = binary.shape
    kernel_width = max(15, width // LINE_KERNEL_DIVISOR)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_width, 1))
    opened = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    min_width = width * MIN_LINE_COVERAGE

    traces: list[np.ndarray] = []
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_WIDTH] < min_width:
            continue
        ys, xs = np.nonzero(labels == label)
        uniq_x, inverse = np.unique(xs, return_inverse=True)
        counts = np.bincount(inverse)
        sums = np.bincount(inverse, weights=ys.astype(float))
        trace = np.full(width, np.nan)
        trace[uniq_x] = sums / counts
        traces.append(trace)
    return traces


def _group_bands(traces: list[np.ndarray], height: int) -> list[tuple[float, np.ndarray]]:
    """Regroupe les traits proches en bandes et ajuste une courbe par bande.

    Des traits voisins en y (une même portée, ou les deux portées d'un même
    système) partagent le même gondolage physique : on les regroupe et on
    ajuste une seule parabole sur leurs points combinés, recentrés chacun sur
    sa propre moyenne pour ne garder que la forme de la courbure. Deux bandes
    séparées par un grand vide (deux systèmes) restent indépendantes.
    """
    means = [float(np.nanmean(trace)) for trace in traces]
    order = np.argsort(means)
    gap = height * BAND_GAP_RATIO

    bands: list[list[int]] = []
    for idx in order:
        if bands and means[idx] - means[bands[-1][-1]] <= gap:
            bands[-1].append(idx)
        else:
            bands.append([idx])

    curves: list[tuple[float, np.ndarray]] = []
    for band in bands:
        if len(band) < MIN_TRACES_FOR_WARP:
            continue
        xs_parts: list[np.ndarray] = []
        ys_parts: list[np.ndarray] = []
        for idx in band:
            trace = traces[idx]
            valid = np.flatnonzero(~np.isnan(trace))
            if valid.size == 0:
                continue
            xs_parts.append(valid)
            ys_parts.append(trace[valid] - means[idx])
        if not xs_parts:
            continue
        xs = np.concatenate(xs_parts)
        ys = np.concatenate(ys_parts)
        coeffs = np.polyfit(xs, ys, CURVE_POLY_DEGREE)
        anchor_y = float(np.mean([means[idx] for idx in band]))
        curves.append((anchor_y, coeffs))
    return sorted(curves, key=lambda item: item[0])


def estimate_warp(gray: np.ndarray) -> np.ndarray | None:
    """Champ de correction verticale (une valeur par pixel), ou `None`.

    Interpole entre les courbes de bandes successives (voir `_group_bands`)
    pour obtenir un champ continu sur toute la page ; au-delà de la première
    ou dernière bande, prolonge la courbe la plus proche à plat. `None` quand
    la page est trop pauvre en traits pleine largeur pour être fiable — le
    simple angle global (`detect_skew`/`deskew`) prend alors le relais.
    """
    height, width = gray.shape
    traces = _line_traces(_binarise(gray))
    bands = _group_bands(traces, height)
    if not bands:
        return None

    columns = np.arange(width, dtype=float)
    curves = [np.polyval(coeffs, columns) for _, coeffs in bands]
    anchors = [anchor for anchor, _ in bands]

    rows = np.arange(height, dtype=float)
    offsets = np.empty((height, width), dtype=np.float32)
    for y in range(height):
        row = float(rows[y])
        if row <= anchors[0]:
            offsets[y] = curves[0]
        elif row >= anchors[-1]:
            offsets[y] = curves[-1]
        else:
            i = np.searchsorted(anchors, row) - 1
            span = anchors[i + 1] - anchors[i]
            t = (row - anchors[i]) / span if span > 0 else 0.0
            offsets[y] = (1.0 - t) * curves[i] + t * curves[i + 1]
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

    Le redressement local par bande (`estimate_warp`/`dewarp`) traite aussi
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
        (abs(angle), global_straight, global_binary, group_staves(_staff_levels(global_binary)))
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
                group_staves(_staff_levels(local_binary)),
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
