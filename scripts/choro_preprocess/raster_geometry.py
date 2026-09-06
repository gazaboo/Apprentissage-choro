"""Moteur de repli : détection par morphologie mathématique OpenCV.

Ce pipeline n'est utilisé que si l'extraction vectorielle ne trouve aucune
portée — typiquement une partition scannée, ou un PDF dont les traits sont
encapsulés dans une image bitmap. Il travaille en pixels ; `measures.py`
normalisant par la taille de page, les coordonnées restent cohérentes.

Le redressement (deskew) est ici indispensable : sur un scan, des portées même
légèrement inclinées font échouer les projections en lignes et en colonnes.
"""

from __future__ import annotations

import cv2
import numpy as np

from .measures import PageGeometry, Staff, build_levels, group_staves

MAX_SKEW_DEGREES = 15.0  # plage d'angles explorée par la transformée de Hough
LEVEL_TOLERANCE = 1.5  # en pixels : deux bandes voisines = même ligne
STAFF_LINE_COVERAGE = 0.25  # part de la largeur devant être encrée
BARLINE_COVERAGE = 0.85  # part de la hauteur de portée devant être encrée


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

    Retourne la géométrie, l'image redressée (celle qu'il faut enregistrer,
    pour que les boîtes correspondent au pixel près) et l'angle appliqué.
    """
    angle = detect_skew(_binarise(gray))
    straight = deskew(gray, angle)
    binary = _binarise(straight)

    staves = group_staves(_staff_levels(binary))
    for staff in staves:
        found = list(staff.barlines) + _detect_barlines(binary, staff)
        staff.barlines = sorted(x for x in found if staff.x_left < x < staff.x_right)

    height, width = straight.shape[:2]
    geometry = PageGeometry(
        width=float(width), height=float(height), staves=staves, source="raster"
    )
    return geometry, straight, angle
