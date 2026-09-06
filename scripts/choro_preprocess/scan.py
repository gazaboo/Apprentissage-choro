"""Lecture de l'arborescence source : morceaux, URLs YouTube, PDF catégorisés.

Tout est tolérant aux données manquantes : un fichier absent, vide ou
illisible produit `None`, jamais une exception.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Instruments / transpositions
# ---------------------------------------------------------------------------

INSTRUMENT_NAMES = {
    "c": "Concert (Ut / C)",
    "bb": "Clarinette (Si♭ / Bb)",
    "eb": "Saxophone (Mi♭ / Eb)",
}

# Ordre d'affichage dans le frontend.
INSTRUMENT_ORDER = ["c", "bb", "eb"]

_RE_BB = re.compile(r"\b(bb|clarinet(te)?)\b", re.IGNORECASE)
_RE_EB = re.compile(r"\b(eb|saxo(phone)?|alto)\b", re.IGNORECASE)

# ---------------------------------------------------------------------------
# URLs YouTube
# ---------------------------------------------------------------------------

_RE_YOUTUBE = re.compile(
    r"https?://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?[^\s)]*\bv=|embed/|live/|shorts/)"
    r"|youtu\.be/)([A-Za-z0-9_-]{11})",
    re.IGNORECASE,
)
_RE_ANY_URL = re.compile(r"https?://[^\s)>\]]+")


@dataclass
class AudioSource:
    url: str
    youtube_id: str

    def to_dict(self) -> dict:
        return {"url": self.url, "youtube_id": self.youtube_id}


@dataclass
class ScorePdf:
    instrument_id: str
    instrument_name: str
    path: Path


@dataclass
class SongFolder:
    song_id: str
    title: str
    composer: str
    folder: Path
    reference: AudioSource | None = None
    playback: AudioSource | None = None
    scores: list[ScorePdf] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def slugify(text: str) -> str:
    """Translittère en ASCII puis produit un slug kebab-case."""
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_text = "".join(c for c in decomposed if not unicodedata.combining(c))
    ascii_text = ascii_text.encode("ascii", "ignore").decode("ascii")
    ascii_text = re.sub(r"[^A-Za-z0-9]+", "-", ascii_text).strip("-").lower()
    return ascii_text or "sans-titre"


def resolve_source_dir(root: Path, name: str) -> Path | None:
    """Trouve le dossier source sans tenir compte de la casse."""
    candidate = root / name
    if candidate.is_dir():
        return candidate
    lowered = name.lower()
    for child in sorted(root.iterdir()):
        if child.is_dir() and child.name.lower() == lowered:
            return child
    return None


def parse_folder_name(name: str) -> tuple[str, str]:
    """`Benzinho - Jacob do bandolim` -> ('Benzinho', 'Jacob do bandolim').

    On coupe sur le dernier " - " (espace-tiret-espace) : les tirets internes
    aux noms propres (`K-Ximbinho`) ne sont pas entourés d'espaces et ne
    perturbent donc pas la découpe.
    """
    if " - " in name:
        title, composer = name.rsplit(" - ", 1)
        return title.strip(), composer.strip()
    return name.strip(), ""


def extract_youtube(md_path: Path) -> AudioSource | None:
    """Extrait la première URL YouTube d'un fichier markdown.

    Retourne None si le fichier est absent, vide, illisible, ou ne contient
    aucune URL YouTube reconnaissable.
    """
    try:
        if not md_path.is_file():
            return None
        text = md_path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    if not text:
        return None

    match = _RE_YOUTUBE.search(text)
    if not match:
        return None
    url_match = _RE_ANY_URL.search(text, match.start())
    url = url_match.group(0) if url_match else match.group(0)
    return AudioSource(url=url.rstrip(".,;"), youtube_id=match.group(1))


def classify_pdf(filename: str) -> str:
    """Déduit l'identifiant d'instrument depuis le nom de fichier.

    L'ordre compte : on teste Bb puis Eb, et tout ce qui ne mentionne aucune
    transposition retombe sur la partition en Ut.
    """
    stem = Path(filename).stem
    if _RE_BB.search(stem):
        return "bb"
    if _RE_EB.search(stem):
        return "eb"
    return "c"


def _naming_score(pdf: Path, title: str, composer: str) -> int:
    """Départage deux PDF concurrents pour un même instrument.

    Priorité au fichier suivant le motif `Compositeur - Titre`, puis à celui
    dont le nom contient le titre, puis au nom le plus court.
    """
    stem_slug = slugify(pdf.stem)
    score = 0
    if composer and stem_slug.startswith(slugify(composer)):
        score += 4
    if title and slugify(title) in stem_slug:
        score += 2
    if "theme" in stem_slug:
        score += 1
    return score


# ---------------------------------------------------------------------------
# Scan principal
# ---------------------------------------------------------------------------


def scan_song_folder(folder: Path) -> SongFolder:
    title, composer = parse_folder_name(folder.name)
    song = SongFolder(
        song_id=slugify(folder.name),
        title=title,
        composer=composer,
        folder=folder,
    )

    song.reference = extract_youtube(folder / "url.md")
    song.playback = extract_youtube(folder / "url-playback.md")
    if song.reference is None:
        song.warnings.append("pas d'URL de reference (url.md absent ou vide)")
    if song.playback is None:
        song.warnings.append("pas d'URL de playback (url-playback.md absent ou vide)")

    # Regroupement des PDF par instrument, puis arbitrage des conflits.
    by_instrument: dict[str, list[Path]] = {}
    for pdf in sorted(folder.glob("*.pdf")):
        by_instrument.setdefault(classify_pdf(pdf.name), []).append(pdf)

    for instrument_id in INSTRUMENT_ORDER:
        candidates = by_instrument.get(instrument_id)
        if not candidates:
            continue
        if len(candidates) > 1:
            ranked = sorted(
                candidates,
                key=lambda p: (-_naming_score(p, title, composer), len(p.name)),
            )
            kept, discarded = ranked[0], ranked[1:]
            song.warnings.append(
                "CONFLIT {}: {} PDF pour le meme instrument -> retenu '{}', ignore(s) {}".format(
                    instrument_id.upper(),
                    len(candidates),
                    kept.name,
                    ", ".join(f"'{p.name}'" for p in discarded),
                )
            )
        else:
            kept = candidates[0]
        song.scores.append(
            ScorePdf(
                instrument_id=instrument_id,
                instrument_name=INSTRUMENT_NAMES[instrument_id],
                path=kept,
            )
        )

    if not song.scores:
        song.warnings.append("aucun PDF trouve")

    return song


def scan_library(source_dir: Path) -> list[SongFolder]:
    """Parcourt tous les sous-dossiers de morceaux, triés par titre."""
    songs = [
        scan_song_folder(child)
        for child in sorted(source_dir.iterdir())
        if child.is_dir() and not child.name.startswith(".")
    ]
    songs.sort(key=lambda s: slugify(s.title))
    return songs
