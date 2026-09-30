#!/usr/bin/env python3
"""Repère les parties (A, B, C…) dans les bandes audio déjà encodées.

Pour chaque morceau qui a une grille d'accords (`data/grilles/<id>.json`),
aligne chaque bande sur la grille (voir `choro_preprocess/sections.py`) et
écrit dans son sidecar :

    "sections": [{"part": "A", "start": 0.65, "end": 19.46}, …],
    "sections_confidence": "high" | "low"

Comme `detect_bpm.py`, le script ne fait que lire les `.opus` : rejouable
sans risque si l'algorithme change. Les morceaux sans grille sont ignorés.

    python scripts/detect_sections.py --dry-run     # affiche les découpages
    python scripts/detect_sections.py               # écrit les sidecars
    python scripts/detect_sections.py --only cheguei --force
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from choro_preprocess.audio_assets import (
    KINDS,
    read_sidecar,
    resolve_site_path,
    write_sidecar,
)
from choro_preprocess.sections import Detection, detect_sections

DEFAULT_OUT = "web/public/data"
GRILLES_DIRNAME = "grilles"


def log(message: str = "") -> None:
    print(message, flush=True)


def load_grilles(out_dir: Path) -> dict[str, dict]:
    """Grilles utilisables, par id de morceau (l'index et le README exclus)."""
    grilles: dict[str, dict] = {}
    for path in sorted((out_dir / GRILLES_DIRNAME).glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and data.get("parts"):
            grilles[str(data.get("song_id") or path.stem)] = data
    return grilles


def format_time(seconds: float) -> str:
    return f"{int(seconds // 60)}:{seconds % 60:05.2f}"


def describe(detection: Detection) -> str:
    form = " ".join(section["part"] for section in detection.sections) or "—"
    return (
        f"{form}  [confiance {detection.confidence}, couverture {detection.coverage:.0%}, "
        f"transposition {detection.shift:+d}, {detection.beats_per_measure} temps/mesure]"
    )


def _job(args: tuple[str, str, str, dict, float | None]) -> tuple[str, str, Detection | None]:
    song_id, kind, audio_path, grille, bpm = args
    return song_id, kind, detect_sections(Path(audio_path), grille, bpm)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--only", help="ne traite que les morceaux dont l'id contient ce texte")
    parser.add_argument(
        "--source", choices=KINDS, help="ne traite qu'une bande (reference ou playback)"
    )
    parser.add_argument(
        "--force", action="store_true", help="recalcule même une bande déjà découpée"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="affiche les découpages sans écrire les sidecars"
    )
    parser.add_argument(
        "--jobs", type=int, default=4, help="bandes analysées en parallèle (défaut 4)"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    out_dir = (Path.cwd() / args.out).resolve()
    grilles = load_grilles(out_dir)
    if args.only:
        needle = args.only.lower()
        grilles = {k: v for k, v in grilles.items() if needle in k.lower()}
        if not grilles:
            log(f"ERREUR: aucune grille ne correspond à --only {args.only!r}")
            return 1

    log(f"Sortie : {out_dir}")
    if args.dry_run:
        log("(dry-run : aucun sidecar ne sera modifié)")
    log()

    jobs = []
    for song_id, grille in grilles.items():
        sidecar = read_sidecar(out_dir, song_id)
        for kind in (args.source,) if args.source else KINDS:
            entry = sidecar.get(kind)
            if not entry or not entry.get("file"):
                continue
            if "sections" in entry and not args.force:
                log(f"  = {song_id}/{kind}: déjà découpée (--force pour recalculer)")
                continue
            audio_path = resolve_site_path(out_dir, entry["file"])
            if not audio_path.is_file():
                log(f"  ! {song_id}/{kind}: fichier introuvable ({audio_path})")
                continue
            jobs.append((song_id, kind, str(audio_path), grille, entry.get("bpm")))

    results: dict[str, dict[str, Detection]] = {}
    with ProcessPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for song_id, kind, detection in pool.map(_job, jobs):
            if detection is None:
                log(f"  ! {song_id}/{kind}: analyse impossible (librosa installé ?)")
                continue
            results.setdefault(song_id, {})[kind] = detection
            mark = "✓" if detection.confidence == "high" else "?"
            log(f"  {mark} {song_id}/{kind}: {describe(detection)}")
            for section in detection.sections:
                log(
                    f"      {section['part']:<10} {format_time(section['start'])}"
                    f" → {format_time(section['end'])}"
                )

    if not args.dry_run:
        for song_id, detections in results.items():
            sidecar = read_sidecar(out_dir, song_id)
            for kind, detection in detections.items():
                sidecar[kind]["sections"] = detection.sections
                sidecar[kind]["sections_confidence"] = detection.confidence
            write_sidecar(out_dir, song_id, sidecar)

    total = sum(len(d) for d in results.values())
    doubtful = sum(1 for d in results.values() for x in d.values() if x.confidence != "high")
    log()
    log(f"{total} bande(s) découpée(s), dont {doubtful} à confiance faible.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
