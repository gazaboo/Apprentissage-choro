#!/usr/bin/env python3
"""Génère les assets statiques du frontend depuis l'arborescence des PDF.

Parcourt `pdf-partitions/`, rastérise chaque partition, détecte les mesures et
écrit images WebP + `manifest.json` dans `web/public/data/`.

    python scripts/preprocess_all.py --only benzinho --debug
    python scripts/preprocess_all.py

Le script ne s'arrête jamais sur une donnée manquante : URL absente, fichier
markdown vide, instrument non fourni sont signalés puis contournés.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import traceback
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from choro_preprocess import manifest as manifest_mod
from choro_preprocess import raster_geometry, render, scan, vector_geometry
from choro_preprocess.measures import measures_for_page, normalise

DEFAULT_SOURCE = "pdf-partitions"
DEFAULT_OUT = "web/public/data"
DEFAULT_DPI = 300


@dataclass
class Report:
    """Compteurs et anomalies accumulés pendant la passe."""

    songs: int = 0
    instruments: int = 0
    pages: int = 0
    measures: int = 0
    raster_pages: int = 0
    bytes_written: int = 0
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def log(message: str) -> None:
    print(message, flush=True)


# ---------------------------------------------------------------------------
# Traitement d'une partition
# ---------------------------------------------------------------------------


def process_pdf(
    score: scan.ScorePdf,
    song_id: str,
    out_dir: Path,
    data_prefix: str,
    dpi: int,
    force_raster: bool,
    debug: bool,
    report: Report,
) -> list[dict]:
    """Rastérise un PDF et retourne la liste des pages du manifeste."""
    pages: list[dict] = []
    document = pymupdf.open(score.path)
    target_dir = out_dir / song_id / score.instrument_id

    try:
        for index, page in enumerate(document):
            page_number = index + 1
            image = render.render_page(page, dpi)

            geometry = None
            if not force_raster:
                geometry = vector_geometry.page_geometry(page)
                if not geometry.staves:
                    geometry = None

            if geometry is None:
                # Repli OpenCV : redressement puis morphologie.
                geometry, straight, angle = raster_geometry.analyse(
                    render.to_grayscale_array(image)
                )
                # On enregistre l'image redressée : les boîtes s'y réfèrent.
                image = Image.fromarray(straight).convert("RGB")
                report.raster_pages += 1
                report.warnings.append(
                    f"{song_id}/{score.instrument_id} p{page_number}: "
                    f"repli raster (deskew {angle:+.2f}deg, "
                    f"{len(geometry.staves)} portees)"
                )

            boxes = measures_for_page(geometry)
            if not boxes:
                report.warnings.append(
                    f"{song_id}/{score.instrument_id} p{page_number}: "
                    "aucune mesure detectee"
                )

            image_name = f"page_{page_number}.webp"
            report.bytes_written += render.save_webp(image, target_dir / image_name)
            if debug:
                render.save_debug_overlay(
                    image,
                    geometry,
                    boxes,
                    target_dir / f"page_{page_number}.debug.png",
                )

            # L'identifiant reste vide : il est attribué en fin de PDF, pour
            # que la numérotation soit continue d'une page à l'autre.
            measures = [
                {"id": "", "box": normalise(box, geometry.width, geometry.height)}
                for box in boxes
            ]
            pages.append(
                manifest_mod.page_entry(
                    page_number,
                    f"{data_prefix}/{song_id}/{score.instrument_id}/{image_name}",
                    measures,
                    geometry.source,
                )
            )
            report.pages += 1
    finally:
        document.close()

    # Numérotation continue sur tout le PDF, en ordre de lecture.
    counter = 0
    for page_data in pages:
        for measure in page_data["measures"]:
            counter += 1
            measure["id"] = f"m{counter}"
    report.measures += counter
    return pages


def process_song(
    song: scan.SongFolder,
    out_dir: Path,
    data_prefix: str,
    dpi: int,
    force_raster: bool,
    debug: bool,
    report: Report,
) -> dict | None:
    """Traite un morceau complet ; retourne son entrée de manifeste."""
    for warning in song.warnings:
        report.warnings.append(f"{song.song_id}: {warning}")

    instruments: list[dict] = []
    for score in song.scores:
        try:
            pages = process_pdf(
                score, song.song_id, out_dir, data_prefix, dpi, force_raster,
                debug, report,
            )
        except Exception as exc:  # une partition cassée ne doit pas tout arrêter
            report.errors.append(f"{song.song_id}/{score.instrument_id}: {exc}")
            traceback.print_exc()
            continue
        if not pages:
            continue
        instruments.append(
            manifest_mod.instrument_entry(
                score.instrument_id, score.instrument_name, pages
            )
        )
        report.instruments += 1

    if not instruments:
        report.warnings.append(f"{song.song_id}: aucune partition exploitable, ignore")
        return None

    report.songs += 1
    measures = sum(i["measure_count"] for i in instruments)
    log(
        f"  ✓ {song.title} — {len(instruments)} partition(s), "
        f"{sum(i['page_count'] for i in instruments)} page(s), {measures} mesures"
    )
    return manifest_mod.song_entry(song, instruments)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prétraitement des partitions choro vers assets statiques.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="dossier des PDF")
    parser.add_argument("--out", default=DEFAULT_OUT, help="dossier de sortie")
    parser.add_argument("--dpi", type=int, default=DEFAULT_DPI, help="résolution")
    parser.add_argument(
        "--only",
        default=None,
        help="ne traiter que les morceaux dont l'identifiant contient ce texte",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="écrire un page_N.debug.png par page avec les boîtes tracées",
    )
    parser.add_argument(
        "--force-raster",
        action="store_true",
        help="forcer le pipeline OpenCV (test du repli)",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="vider le dossier de sortie avant de générer",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = Path.cwd()

    source_dir = scan.resolve_source_dir(root, args.source)
    if source_dir is None:
        log(f"ERREUR: dossier source introuvable: {args.source}")
        return 1

    if args.clean and args.only:
        # Le manifeste serait réécrit avec le seul morceau demandé, et les
        # images des autres auraient disparu : refus plutôt que perte muette.
        log("ERREUR: --clean et --only sont incompatibles (cela effacerait les "
            "autres morceaux du dossier de sortie).")
        return 1

    out_dir = (root / args.out).resolve()
    if args.clean and out_dir.exists():
        shutil.rmtree(out_dir)
    # Le manifeste référence les images via ce préfixe, relatif à la racine du site.
    data_prefix = out_dir.name

    log(f"Source : {source_dir}")
    log(f"Sortie : {out_dir}  ({args.dpi} DPI)\n")

    report = Report()
    songs = scan.scan_library(source_dir)
    if args.only:
        needle = args.only.lower()
        songs = [s for s in songs if needle in s.song_id.lower()]
        if not songs:
            log(f"ERREUR: aucun morceau ne correspond à --only {args.only!r}")
            return 1

    entries: list[dict] = []
    for song in songs:
        entry = process_song(
            song, out_dir, data_prefix, args.dpi, args.force_raster, args.debug, report
        )
        if entry:
            entries.append(entry)

    # Une passe partielle complète le manifeste existant au lieu de l'écraser.
    destination = manifest_mod.write_manifest(entries, out_dir, merge=bool(args.only))

    log("\n" + "─" * 66)
    log(
        f"{report.songs} morceaux · {report.instruments} partitions · "
        f"{report.pages} pages · {report.measures} mesures"
    )
    log(
        f"Images : {report.bytes_written / 1_048_576:.1f} Mo · "
        f"repli raster : {report.raster_pages} page(s)"
    )
    log(f"Manifeste : {destination}")

    if report.warnings:
        log(f"\n{len(report.warnings)} avertissement(s) :")
        for warning in report.warnings:
            log(f"  ! {warning}")
    if report.errors:
        log(f"\n{len(report.errors)} erreur(s) :")
        for error in report.errors:
            log(f"  ✗ {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
