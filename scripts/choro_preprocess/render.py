"""Rendu des pages en WebP et génération des calques de contrôle visuel."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageDraw

from .measures import MeasureBox, PageGeometry

WEBP_QUALITY = 82


def render_page(page: pymupdf.Page, dpi: int) -> Image.Image:
    """Rastérise une page PDF en image RGB."""
    pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def to_grayscale_array(image: Image.Image) -> np.ndarray:
    """Vue niveaux de gris pour le pipeline OpenCV de repli."""
    return np.asarray(image.convert("L"))


def save_webp(image: Image.Image, destination: Path) -> int:
    """Enregistre en WebP et retourne la taille du fichier en octets."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="WEBP", quality=WEBP_QUALITY, method=6)
    return destination.stat().st_size


def save_debug_overlay(
    image: Image.Image,
    geometry: PageGeometry,
    boxes: list[MeasureBox],
    destination: Path,
) -> None:
    """Trace portées, barres et boîtes de mesure par-dessus la page.

    C'est l'outil de contrôle du réglage : rouge = boîte composite retenue,
    bleu = étendue de la portée, vert = barre de mesure détectée.
    """
    scale_x = image.width / geometry.width
    scale_y = image.height / geometry.height
    canvas = image.convert("RGB").copy()
    draw = ImageDraw.Draw(canvas, "RGBA")

    for staff in geometry.staves:
        draw.rectangle(
            [
                staff.x_left * scale_x,
                staff.y_top * scale_y,
                staff.x_right * scale_x,
                staff.y_bottom * scale_y,
            ],
            outline=(30, 100, 255, 220),
            width=2,
        )
        for x in staff.barlines:
            draw.line(
                [
                    (x * scale_x, (staff.y_top - staff.height) * scale_y),
                    (x * scale_x, (staff.y_bottom + staff.height) * scale_y),
                ],
                fill=(0, 170, 60, 200),
                width=2,
            )

    for i, box in enumerate(boxes):
        left, top = box.x * scale_x, box.y * scale_y
        right, bottom = (box.x + box.w) * scale_x, (box.y + box.h) * scale_y
        draw.rectangle([left, top, right, bottom], outline=(230, 30, 60, 255), width=3)
        draw.text((left + 6, top + 4), str(i + 1), fill=(230, 30, 60, 255))

    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, format="PNG")
