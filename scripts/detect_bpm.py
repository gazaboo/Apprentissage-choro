#!/usr/bin/env python3
"""Mesure le tempo (BPM) des bandes audio déjà encodées (#111).

Complète les sidecars produits par `fetch_audio.py` avec un champ `bpm`,
sans jamais toucher aux fichiers `.opus` eux-mêmes : contrairement à
`fetch_audio.py`, ce script ne télécharge ni ne transcode rien, il ne fait
que lire un `.opus` existant et écrire un flottant de plus dans son sidecar.
C'est ce qui le rend rejouable sans risque si l'algorithme de détection
change — pas de coût d'encodage, pas de blob git supplémentaire.

    python scripts/detect_bpm.py --dry-run     # affiche les tempos trouvés
    python scripts/detect_bpm.py               # écrit bpm dans les sidecars
    python scripts/detect_bpm.py --only benzinho --force

`--force` recalcule même une bande qui a déjà un `bpm` (utile si
`detect_bpm()` change). Sans lui, une bande déjà mesurée est sautée.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from choro_preprocess import scan
from choro_preprocess.audio_assets import (
    KINDS,
    read_sidecar,
    resolve_site_path,
    write_sidecar,
)
from choro_preprocess.tempo import detect_bpm

DEFAULT_SOURCE = "pdf-partitions"
DEFAULT_OUT = "web/public/data"


def log(message: str = "") -> None:
    print(message, flush=True)


def process_song(
    song: scan.SongFolder,
    out_dir: Path,
    force: bool,
    dry_run: bool,
    only_kind: str | None,
    results: list[tuple[str, str, float]],
) -> None:
    sidecar = read_sidecar(out_dir, song.song_id)
    changed = False
    for kind in (only_kind,) if only_kind else KINDS:
        entry = sidecar.get(kind)
        if not entry or not entry.get("file"):
            continue
        if "bpm" in entry and not force:
            results.append((song.song_id, kind, entry["bpm"]))
            continue

        audio_path = resolve_site_path(out_dir, entry["file"])
        if not audio_path.is_file():
            log(f"  ! {song.song_id}/{kind}: fichier introuvable ({audio_path})")
            continue

        bpm = detect_bpm(audio_path)
        if bpm is None:
            log(f"  ! {song.song_id}/{kind}: détection échouée")
            continue

        results.append((song.song_id, kind, bpm))
        log(f"  ✓ {song.song_id}/{kind}: {bpm} BPM")
        if not dry_run:
            entry["bpm"] = bpm
            sidecar[kind] = entry
            changed = True

    if changed and not dry_run:
        write_sidecar(out_dir, song.song_id, sidecar)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source-dir", default=DEFAULT_SOURCE)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--only", help="ne traite que les morceaux dont l'id contient ce texte")
    parser.add_argument(
        "--source", choices=KINDS, help="ne traite qu'une bande (reference ou playback)"
    )
    parser.add_argument(
        "--force", action="store_true", help="recalcule même une bande déjà mesurée"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="affiche les tempos trouvés sans écrire les sidecars"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = Path.cwd()

    source_dir = scan.resolve_source_dir(root, args.source_dir)
    if source_dir is None:
        log(f"ERREUR: dossier source introuvable: {args.source_dir}")
        return 1
    out_dir = (root / args.out).resolve()

    songs = scan.scan_library(source_dir)
    if args.only:
        needle = args.only.lower()
        songs = [s for s in songs if needle in s.song_id.lower()]
        if not songs:
            log(f"ERREUR: aucun morceau ne correspond à --only {args.only!r}")
            return 1

    log(f"Source : {source_dir}")
    log(f"Sortie : {out_dir}")
    if args.dry_run:
        log("(dry-run : aucun sidecar ne sera modifié)")
    log()

    results: list[tuple[str, str, float]] = []
    for song in songs:
        process_song(song, out_dir, args.force, args.dry_run, args.source, results)

    log()
    log(f"{len(results)} bande(s) mesurée(s) au total.")
    if results:
        log()
        log("Récapitulatif trié par tempo :")
        for song_id, kind, bpm in sorted(results, key=lambda r: r[2]):
            log(f"  {bpm:>6.1f} BPM  {song_id}/{kind}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
