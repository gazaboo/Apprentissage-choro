#!/usr/bin/env python3
"""Télécharge et transcode en Opus local l'audio de chaque morceau (#18).

Remplace la dépendance aux iframes YouTube : les fichiers produits sont
commités dans `web/public/data/` et servis par Netlify comme le reste du site.

    python scripts/fetch_audio.py                       # incrémental
    python scripts/fetch_audio.py --only benzinho
    python scripts/fetch_audio.py --only benzinho --source playback \
           --from-file ~/benzinho-v2.wav --force
    python scripts/fetch_audio.py --verify

Deux garde-fous protègent l'historique git, où chaque Opus est un blob
définitif : git ne sait tirer aucun delta d'un flux déjà compressé.

  * Le script est **idempotent** : une source déjà encodée avec la même URL et
    les mêmes paramètres est sautée, jamais réécrite.
  * `--force` est **refusé sans `--only`** : un ré-encodage global coûterait
    plus de 100 Mo définitifs, et se fait par réécriture d'historique
    (`git filter-repo`), pas par un passage du script.

Les noms portent un hash du contenu (`reference.a1b2c3d4.opus`) : remplacer un
audio produit une URL neuve, ce qui rend honnête l'en-tête `Cache-Control:
immutable` posé côté Netlify.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from choro_preprocess import scan
from choro_preprocess.audio_assets import (
    EXTENSION,
    KINDS,
    audio_dir,
    read_sidecar,
    resolve_site_path,
    site_path,
    write_sidecar,
)

DEFAULT_SOURCE = "pdf-partitions"
DEFAULT_OUT = "web/public/data"

# ---------------------------------------------------------------------------
# Paramètres d'encodage — GELÉS
# ---------------------------------------------------------------------------
#
# Toute modification de ce bloc périme les 95 fichiers d'un coup. Ce n'est pas
# une opération à faire à la légère : voir l'avertissement en tête de module.
# La signature est recopiée dans chaque sidecar pour que la dérive soit
# détectable au lieu d'être silencieuse.

ENCODE_VERSION = "opus48k-mono48000-v1"

# Mono explicite dans la chaîne de filtres (et non par `-ac 1` en sortie) pour
# que `loudnorm` mesure le signal réellement encodé, pas le stéréo d'origine.
MONO_FILTER = "aformat=channel_layouts=mono"
RESAMPLE_FILTER = "aresample=48000"

# EBU R128. Sans normalisation, la bascule « Avec / Sans mélodie » fait un saut
# de volume : les enregistrements originaux et les playbacks ne sont pas
# masterisés au même niveau.
LOUDNORM_TARGET = "loudnorm=I=-16:TP=-1.5:LRA=11"

OPUS_ARGS = [
    "-c:a", "libopus",
    "-b:a", "48k",
    "-vbr", "on",
    "-application", "audio",
    "-map_metadata", "-1",
]

YTDLP_ARGS = ["-f", "bestaudio/best", "--no-playlist", "--no-progress", "--quiet"]


def encode_signature(loudnorm: bool) -> str:
    return ENCODE_VERSION + ("+loudnorm" if loudnorm else "+raw")


# ---------------------------------------------------------------------------
# Outils externes
# ---------------------------------------------------------------------------


def log(message: str = "") -> None:
    print(message, flush=True)


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def require_tools() -> list[str]:
    return [tool for tool in ("yt-dlp", "ffmpeg", "ffprobe") if shutil.which(tool) is None]


def probe_duration(path: Path) -> float | None:
    proc = run([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
    ])
    if proc.returncode != 0:
        return None
    try:
        return round(float(proc.stdout.strip()), 2)
    except ValueError:
        return None


def digest_of(path: Path) -> str:
    """sha256 d'un fichier, lu par blocs (les sources font des dizaines de Mo)."""
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(block)
    return hasher.hexdigest()


def measure_loudness(src: Path) -> dict | None:
    """Première passe de `loudnorm` : relève les niveaux réels du fichier.

    Une passe unique suffirait, mais elle corrige à l'aveugle et rate sa cible
    de plusieurs dB sur un morceau au niveau inhabituel. Retourne `None` si la
    mesure échoue — l'encodage se rabat alors sur la passe unique.
    """
    proc = run([
        "ffmpeg", "-nostdin", "-hide_banner", "-i", str(src),
        "-af", f"{MONO_FILTER},{LOUDNORM_TARGET}:print_format=json",
        "-f", "null", "-",
    ])
    if proc.returncode != 0:
        return None
    start = proc.stderr.rfind("{")
    end = proc.stderr.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(proc.stderr[start : end + 1])
    except json.JSONDecodeError:
        return None
    needed = ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")
    if not all(key in data for key in needed):
        return None
    return data


def build_filter_chain(src: Path, loudnorm: bool) -> str:
    chain = [MONO_FILTER]
    if loudnorm:
        measured = measure_loudness(src)
        if measured is None:
            chain.append(LOUDNORM_TARGET)
        else:
            chain.append(
                f"{LOUDNORM_TARGET}"
                f":measured_I={measured['input_i']}"
                f":measured_TP={measured['input_tp']}"
                f":measured_LRA={measured['input_lra']}"
                f":measured_thresh={measured['input_thresh']}"
                f":offset={measured['target_offset']}"
                ":linear=true"
            )
    chain.append(RESAMPLE_FILTER)
    return ",".join(chain)


def transcode(src: Path, dest: Path, loudnorm: bool) -> str | None:
    """Encode `src` vers `dest`. Retourne un message d'erreur, ou None."""
    cmd = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src),
        "-vn", "-ac", "1", "-ar", "48000",
        "-af", build_filter_chain(src, loudnorm),
        *OPUS_ARGS,
        str(dest),
    ]
    proc = run(cmd)
    if proc.returncode != 0:
        return (proc.stderr.strip().splitlines() or ["ffmpeg a échoué"])[-1]
    return None


def download(url: str, target_dir: Path) -> tuple[Path | None, str | None]:
    """Récupère le meilleur flux audio. Retourne (fichier, erreur)."""
    template = str(target_dir / "source.%(ext)s")
    proc = run(["yt-dlp", *YTDLP_ARGS, "-o", template, url])
    if proc.returncode != 0:
        return None, (proc.stderr.strip().splitlines() or ["yt-dlp a échoué"])[-1]
    files = sorted(target_dir.glob("source.*"))
    if not files:
        return None, "yt-dlp n'a produit aucun fichier"
    return files[0], None


# ---------------------------------------------------------------------------
# Décision : encoder, sauter, ou signaler une dérive
# ---------------------------------------------------------------------------


@dataclass
class Report:
    encoded: int = 0
    skipped: int = 0
    stale: int = 0
    drifted: int = 0
    removed: int = 0
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def decide(
    entry: dict | None,
    source_url: str,
    signature: str,
    out_dir: Path,
    force: bool,
) -> tuple[str, str]:
    """Retourne (action, raison) où action ∈ {encode, skip, drift}."""
    if force:
        return "encode", "forcé"
    if not entry:
        return "encode", "absent"
    existing = entry.get("file")
    if not existing or not resolve_site_path(out_dir, existing).is_file():
        return "encode", "fichier manquant"
    if entry.get("source_url") != source_url:
        return "encode", "URL modifiée"
    if entry.get("encoded_with") != signature:
        return "drift", f"encodé avec {entry.get('encoded_with')!r}"
    return "skip", "à jour"


def process_source(
    song: scan.SongFolder,
    kind: str,
    source_url: str,
    local_input: Path | None,
    out_dir: Path,
    loudnorm: bool,
    force: bool,
    report: Report,
) -> dict | None:
    """Produit (ou conserve) le fichier d'une bande. Retourne l'entrée sidecar."""
    sidecar = read_sidecar(out_dir, song.song_id)
    entry = sidecar.get(kind)
    signature = encode_signature(loudnorm)

    action, reason = decide(entry, source_url, signature, out_dir, force)

    if action == "skip":
        report.skipped += 1
        return entry
    if action == "drift":
        report.drifted += 1
        report.warnings.append(
            f"{song.song_id}/{kind}: {reason}, conservé tel quel "
            f"(attendu {signature!r}) — utiliser --force pour ré-encoder"
        )
        return entry
    if reason == "URL modifiée":
        report.stale += 1

    directory = audio_dir(out_dir, song.song_id)
    directory.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="choro-audio-") as tmp:
        tmp_dir = Path(tmp)
        if local_input is not None:
            src = local_input
        else:
            src, error = download(source_url, tmp_dir)
            if src is None:
                report.errors.append(f"{song.song_id}/{kind}: {error}")
                return entry

        staged = tmp_dir / f"staged{EXTENSION}"
        error = transcode(src, staged, loudnorm)
        if error is not None:
            report.errors.append(f"{song.song_id}/{kind}: {error}")
            return entry

        duration = probe_duration(staged)
        if duration is None:
            report.errors.append(f"{song.song_id}/{kind}: durée illisible après encodage")
            return entry

        short_hash = digest_of(staged)[:8]
        filename = f"{kind}.{short_hash}{EXTENSION}"
        destination = directory / filename
        shutil.move(str(staged), destination)
        input_digest = digest_of(src) if local_input is not None else None

    # Le fichier précédent ne sert plus : l'URL porte désormais un autre hash.
    previous = entry.get("file") if entry else None
    if previous and previous != site_path(out_dir, song.song_id, filename):
        stale_file = resolve_site_path(out_dir, previous)
        if stale_file.is_file():
            stale_file.unlink()
            report.removed += 1

    report.encoded += 1
    size_mo = destination.stat().st_size / 1_048_576
    log(f"    ✓ {kind} ({reason}) — {size_mo:.2f} Mo · {duration:.0f} s · {filename}")

    result = {
        "file": site_path(out_dir, song.song_id, filename),
        "duration": duration,
        "source_url": source_url,
        "encoded_with": signature,
        "encoded_on": date.today().isoformat(),
    }
    if input_digest is not None:
        result["input_digest"] = f"sha256:{input_digest}"
    return result


# ---------------------------------------------------------------------------
# Vérification
# ---------------------------------------------------------------------------


def verify(songs: list[scan.SongFolder], out_dir: Path) -> int:
    problems = 0
    total_bytes = 0
    counted = 0
    for song in songs:
        sidecar = read_sidecar(out_dir, song.song_id)
        directory = audio_dir(out_dir, song.song_id)
        declared: set[str] = set()

        for kind in KINDS:
            entry = sidecar.get(kind)
            expected_url = getattr(song, kind)
            if entry is None:
                if expected_url is not None:
                    log(f"  ! {song.song_id}/{kind}: URL connue mais aucun fichier")
                    problems += 1
                continue
            path = resolve_site_path(out_dir, entry["file"])
            declared.add(path.name)
            if not path.is_file():
                log(f"  ✗ {song.song_id}/{kind}: {entry['file']} introuvable")
                problems += 1
                continue
            total_bytes += path.stat().st_size
            counted += 1
            recorded = entry.get("source_url", "")
            if (
                expected_url is not None
                and not recorded.startswith("file://")
                and recorded != expected_url
            ):
                log(f"  ! {song.song_id}/{kind}: sidecar périmé (URL modifiée)")
                problems += 1

        if directory.is_dir():
            for orphan in sorted(directory.glob(f"*{EXTENSION}")):
                if orphan.name not in declared:
                    log(f"  ! {song.song_id}: {orphan.name} orphelin (aucun sidecar)")
                    problems += 1

    log("")
    log(f"{counted} fichier(s) · {total_bytes / 1_048_576:.1f} Mo au total")
    if problems:
        log(f"{problems} anomalie(s)")
        return 1
    log("Aucune anomalie.")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source-dir", default=DEFAULT_SOURCE)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--only", help="ne traite que les morceaux dont l'id contient ce texte")
    parser.add_argument(
        "--source", choices=KINDS, help="ne traite qu'une bande (reference ou playback)"
    )
    parser.add_argument(
        "--from-file",
        help="transcode ce fichier local au lieu de télécharger (exige --only et --source)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="ré-encode même si le sidecar concorde (refusé sans --only)",
    )
    parser.add_argument("--no-loudnorm", action="store_true", help="encode sans normalisation EBU R128")
    parser.add_argument("--verify", action="store_true", help="contrôle sans rien encoder")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = Path.cwd()

    source_dir = scan.resolve_source_dir(root, args.source_dir)
    if source_dir is None:
        log(f"ERREUR: dossier source introuvable: {args.source_dir}")
        return 1
    out_dir = (root / args.out).resolve()

    # Un `--force` global ré-encoderait les 95 sources : plus de 100 Mo de
    # blobs définitifs ajoutés à l'historique, pour un geste qui tient souvent
    # en un seul morceau. Même refus croisé que `--clean`/`--only` côté
    # `preprocess_all.py`.
    if args.force and not args.only:
        log("ERREUR: --force exige --only (un ré-encodage global alourdit "
            "définitivement l'historique git ; il se fait par réécriture "
            "d'historique, pas par ce script).")
        return 1
    if args.from_file and not (args.only and args.source):
        log("ERREUR: --from-file exige --only et --source.")
        return 1

    local_input: Path | None = None
    if args.from_file:
        local_input = Path(args.from_file).expanduser().resolve()
        if not local_input.is_file():
            log(f"ERREUR: fichier introuvable: {local_input}")
            return 1

    songs = scan.scan_library(source_dir)
    if args.only:
        needle = args.only.lower()
        songs = [s for s in songs if needle in s.song_id.lower()]
        if not songs:
            log(f"ERREUR: aucun morceau ne correspond à --only {args.only!r}")
            return 1

    if args.verify:
        log(f"Vérification de {out_dir}\n")
        return verify(songs, out_dir)

    missing = require_tools()
    if missing:
        log(f"ERREUR: outil(s) absent(s) du PATH : {', '.join(missing)}")
        return 1

    loudnorm = not args.no_loudnorm
    kinds = (args.source,) if args.source else KINDS
    # Désigner un fichier explicitement, c'est déjà demander son encodage.
    force = args.force or local_input is not None

    log(f"Source : {source_dir}")
    log(f"Sortie : {out_dir}")
    log(f"Encodage : {encode_signature(loudnorm)}\n")

    report = Report()
    for song in songs:
        sidecar = read_sidecar(out_dir, song.song_id)
        touched = False
        for kind in kinds:
            declared = getattr(song, kind)
            if declared is None and local_input is None:
                continue
            # Un fichier local est sa propre provenance : enregistrer l'URL
            # YouTube du morceau laisserait croire que c'est elle qui a été
            # encodée, et `--verify` ne verrait jamais la différence.
            source_url = f"file://{local_input}" if local_input else declared
            if not touched:
                log(f"  {song.title}")
                touched = True
            sidecar[kind] = process_source(
                song, kind, source_url, local_input, out_dir, loudnorm, force, report
            )
        if touched:
            write_sidecar(out_dir, song.song_id, sidecar)

    log("\n" + "─" * 66)
    log(
        f"{report.encoded} encodé(s) · {report.skipped} sauté(s) · "
        f"{report.stale} périmé(s) · {report.drifted} en dérive · "
        f"{report.removed} ancien(s) supprimé(s) · {len(report.errors)} en échec"
    )
    for warning in report.warnings:
        log(f"  ! {warning}")
    for error in report.errors:
        log(f"  ✗ {error}")
    return 1 if report.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
