"""Convention de stockage des fichiers audio locaux (#18).

Un seul endroit décrit où vivent les `.opus` et comment le frontend les
adresse : `scripts/fetch_audio.py` les produit, `manifest.py` les publie dans
le manifeste, et les deux doivent s'accorder au caractère près.

Le sidecar `<out>/<song_id>/audio/audio.json` est la source de vérité des
métadonnées audio : relancer le pipeline PDF ne le touche pas, donc une passe
de `preprocess_all.py` ne perd jamais ce que `fetch_audio.py` a produit.
"""

from __future__ import annotations

import json
from pathlib import Path

KINDS = ("reference", "playback")
AUDIO_DIRNAME = "audio"
SIDECAR_NAME = "audio.json"
EXTENSION = ".opus"

# Champs du sidecar repris tels quels dans le manifeste. `encoded_with` et
# `encoded_on` restent internes au pipeline : le frontend n'en a que faire.
PUBLISHED_FIELDS = ("file", "duration", "source_url", "bpm", "sections", "sections_confidence")


def audio_dir(out_dir: Path, song_id: str) -> Path:
    return out_dir / song_id / AUDIO_DIRNAME


def site_path(out_dir: Path, song_id: str, filename: str) -> str:
    """Chemin tel que le frontend le consomme : `data/<slug>/audio/<nom>`."""
    return f"{out_dir.name}/{song_id}/{AUDIO_DIRNAME}/{filename}"


def resolve_site_path(out_dir: Path, value: str) -> Path:
    """Inverse de `site_path` : `data/x/audio/y.opus` -> chemin disque."""
    return out_dir.parent / value


def read_sidecar(out_dir: Path, song_id: str) -> dict:
    """Relit le sidecar ; dict vide s'il est absent, vide ou illisible."""
    path = audio_dir(out_dir, song_id) / SIDECAR_NAME
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def write_sidecar(out_dir: Path, song_id: str, data: dict) -> None:
    directory = audio_dir(out_dir, song_id)
    directory.mkdir(parents=True, exist_ok=True)
    payload = {kind: data.get(kind) for kind in KINDS}
    (directory / SIDECAR_NAME).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def published_entry(entry: dict | None) -> dict:
    """Ne retient du sidecar que ce qui a un sens côté navigateur."""
    if not entry:
        return {}
    return {key: entry[key] for key in PUBLISHED_FIELDS if key in entry}
