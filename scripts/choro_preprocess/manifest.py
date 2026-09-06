"""Construction et sérialisation du manifeste consommé par le frontend."""

from __future__ import annotations

import json
from pathlib import Path

from .scan import SongFolder

MANIFEST_NAME = "manifest.json"


def song_entry(song: SongFolder, instruments: list[dict]) -> dict:
    """Assemble l'entrée JSON d'un morceau."""
    return {
        "id": song.song_id,
        "title": song.title,
        "composer": song.composer,
        "audio": {
            "reference": song.reference.to_dict() if song.reference else None,
            "playback": song.playback.to_dict() if song.playback else None,
        },
        "instruments": instruments,
    }


def instrument_entry(
    instrument_id: str, instrument_name: str, pages: list[dict]
) -> dict:
    return {
        "id": instrument_id,
        "name": instrument_name,
        "page_count": len(pages),
        "measure_count": sum(len(p["measures"]) for p in pages),
        "pages": pages,
    }


def page_entry(
    page_number: int, image_path: str, measures: list[dict], source: str
) -> dict:
    return {
        "page_number": page_number,
        "image_path": image_path,
        "measures_source": source,
        "measures": measures,
    }


def read_manifest(out_dir: Path) -> list[dict]:
    """Relit un manifeste existant ; liste vide s'il est absent ou illisible."""
    source = out_dir / MANIFEST_NAME
    try:
        data = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def write_manifest(songs: list[dict], out_dir: Path, merge: bool = False) -> Path:
    """Écrit `manifest.json` (UTF-8 non échappé, lisible tel quel).

    Avec `merge`, les entrées existantes sont conservées et seules celles qui
    viennent d'être régénérées sont remplacées : retraiter un seul morceau
    avec `--only` ne fait pas disparaître les autres du manifeste.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    if merge:
        regenerated = {song["id"] for song in songs}
        kept = [song for song in read_manifest(out_dir) if song["id"] not in regenerated]
        songs = kept + songs

    songs = sorted(songs, key=lambda song: song.get("title", "").lower())
    destination = out_dir / MANIFEST_NAME
    destination.write_text(
        json.dumps(songs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return destination
