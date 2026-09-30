"""Tests de l'alignement grille ↔ audio (`choro_preprocess/sections.py`).

Pas d'audio ici : on fabrique un chroma par temps à partir des gabarits de la
grille, avec une forme, une transposition, un tempo et du bruit connus
d'avance, et on vérifie que l'alignement les retrouve.

    python -m unittest discover -s scripts/tests
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from choro_preprocess import sections as S  # noqa: E402

# Trois parties aux harmonies distinctes (Fa, Rém, Sib), comme un choro type.
GRILLE = {
    "parts": [
        {
            "name": "A",
            "repeat": True,
            "sequence": [
                ["F"], ["C7/G"], ["F/A"], ["C7/G"], ["A7"], ["Dm"], ["G7"], ["C7"],
                ["F"], ["C7/G"], ["F/A"], ["C7/G"], ["F7"], ["Bb"], ["Bdim", "F/C"], ["Gm", "C7"],
            ],
            "endings": {"1": [["F"]], "2": [["F"]]},
        },
        {
            "name": "B",
            "repeat": True,
            "sequence": [
                ["Dm", "A7/C#"], ["Dm", "D7/F#"], ["Gm", "D7/A"], ["Gm/Bb", "D7/A"],
                ["Gm"], ["Dm/F"], ["E7"], ["A7"],
                ["Dm", "A7/E"], ["D7/F#"], ["Gm", "D7/A"], ["Gm/Bb", "D7"],
                ["Eb"], ["Dm"], ["E7", "A7"], ["Dm"],
            ],
        },
        {
            "name": "C",
            "repeat": True,
            "sequence": [
                ["Bb"], ["Eb"], ["Gb"], ["F7"], ["Bb"], ["Bb", "Em7b5"], ["Cm"], ["F7"],
                ["Bb", "F7"], ["Bb"], ["Bb7"], ["Bb7"], ["Eb"], ["Ebm6"], ["Bb/D", "G7"], ["C7", "F7"],
            ],
            "endings": {"1": [["Bb"]], "2": [["Bb"], ["C7"]]},
        },
    ],
    "coda": [["Dm"], ["A7"], ["Dm"], ["Dm"]],
}

K = 2  # temps par mesure écrite (2/4)


def render(form: list[str], units, shift=0, stretch=1.0, noise=0.15, intro=0, seed=0):
    """Chroma synthétique (12 × temps) + premier temps de chaque passe.

    `form` nomme les blocs à jouer par leur label, le premier bloc de ce
    label étant pris (sauf « C2 » : 2e fin de C). `stretch` > 1 simule une
    battue plus fine que la noire (des temps en plus, répartis régulièrement).
    """
    rng = np.random.default_rng(seed)
    by_name: dict[str, S.Unit] = {}
    for unit in units:
        name = unit.label if unit.label not in by_name else unit.label + "2"
        by_name.setdefault(name, unit)
    columns = [rng.random(12) for _ in range(intro)]
    starts = []
    for name in form:
        starts.append(len(columns))
        templates = S.unit_templates(by_name[name], K)
        n_out = int(round(templates.shape[1] * stretch))
        for i in range(n_out):
            src = min(int(i / stretch), templates.shape[1] - 1)
            columns.append(np.roll(templates[:, src], shift) + noise * rng.random(12))
    return np.stack(columns, axis=1), starts


class ParseChordTest(unittest.TestCase):
    def test_qualities_and_bass(self):
        self.assertEqual(S.parse_chord("A7/C#"), (9, (0, 4, 7, 10), 1))
        self.assertEqual(S.parse_chord("Dm"), (2, (0, 3, 7), None))
        self.assertEqual(S.parse_chord("Bb"), (10, (0, 4, 7), None))
        self.assertEqual(S.parse_chord("Em7b5"), (4, (0, 3, 6, 10), None))
        self.assertEqual(S.parse_chord("Gb/Ab"), (6, (0, 4, 7), 8))
        # Espace parasite relevé dans une grille (« B dim »).
        self.assertEqual(S.parse_chord("B dim"), (11, (0, 3, 6, 9), None))

    def test_unknown_quality_falls_back(self):
        self.assertEqual(S.parse_chord("C7sus9")[1], (0, 4, 7, 10))
        self.assertEqual(S.parse_chord("Cmaj9")[1], (0, 4, 7))
        self.assertIsNone(S.parse_chord("N.C."))

    def test_template_highlights_chord_tones(self):
        template = S.chord_template("G7/B")
        tones = {7, 11, 2, 5}
        self.assertTrue(all(template[pc] > 0 for pc in tones))
        self.assertTrue(all(template[pc] == 0 for pc in set(range(12)) - tones))
        self.assertGreater(template[11], template[2])  # la basse ressort


class BuildUnitsTest(unittest.TestCase):
    def test_endings_and_coda(self):
        units = S.build_units(GRILLE)
        summary = [(u.label, len(u.cells), u.role) for u in units]
        # A : deux fins identiques → un seul bloc ; C : deux fins distinctes.
        self.assertEqual(
            summary,
            [("A", 17, "part"), ("B", 16, "part"), ("C", 17, "part"), ("C", 18, "part"), ("Coda", 4, "coda")],
        )

    def test_short_blocks_are_dropped(self):
        grille = {"parts": [{"name": "pont", "sequence": [["C"], ["G7"]]}], "coda": [["C"]]}
        self.assertEqual(S.build_units(grille), [])

    def test_empty_cell_holds_previous_chord(self):
        unit = S.Unit("A", [["C"], [], ["G7"], ["C"]])
        templates = S.unit_templates(unit, K)
        np.testing.assert_allclose(templates[:, 0], templates[:, 2])
        self.assertLess(float(templates[:, 0] @ templates[:, 4]), 0.99)


class AlignTest(unittest.TestCase):
    def setUp(self):
        self.units = S.build_units(GRILLE)

    def detected(self, chroma, **kwargs):
        alignment = S.align(chroma, self.units, **kwargs)
        return alignment, [(label, a) for label, a, b in S.segments(alignment, self.units) if label]

    def assert_starts_close(self, found, expected, tolerance):
        self.assertEqual(len(found), len(expected), found)
        for got, want in zip(found, expected):
            self.assertLessEqual(abs(got - want), tolerance, (found, expected))

    def test_rondo_form_is_recovered(self):
        form = ["A", "A", "B", "B", "A", "C", "C2", "A", "Coda"]
        chroma, starts = render(form, self.units, intro=6)
        alignment, found = self.detected(chroma)
        self.assertEqual([label for label, _ in found], ["A", "A", "B", "B", "A", "C", "C", "A", "Coda"])
        self.assert_starts_close([a for _, a in found], starts, tolerance=K)
        self.assertEqual(alignment.shift, 0)

    def test_transposed_recording(self):
        chroma, _ = render(["A", "A", "B", "B", "A"], self.units, shift=3, seed=1)
        alignment, found = self.detected(chroma)
        self.assertEqual(alignment.shift, 3)
        self.assertEqual([label for label, _ in found], ["A", "A", "B", "B", "A"])

    def test_beat_tracker_on_a_faster_pulse(self):
        # Battue aux 4/3 de la noire : le cas typique de la rythmique choro.
        stretch = 4 / 3
        form = ["A", "A", "B", "B", "A", "C", "C2", "A"]
        chroma, starts = render(form, self.units, stretch=stretch, seed=2)
        _, found = self.detected(chroma)
        self.assertEqual([label for label, _ in found], [name[0] for name in form])
        self.assert_starts_close([a for _, a in found], starts, tolerance=round(K * stretch))

    def test_beat_tracker_at_double_tempo(self):
        form = ["A", "B", "A"]
        chroma, starts = render(form, self.units, stretch=2.0, seed=3)
        alignment, found = self.detected(chroma)
        self.assertEqual(alignment.beats_per_measure, 4)
        self.assertEqual([label for label, _ in found], form)
        self.assert_starts_close([a for _, a in found], starts, tolerance=2 * K)

    def test_skipped_repeat_and_improvised_chorus(self):
        # Pas de reprise de A, puis un chorus hors grille (bruit) avant B.
        rng = np.random.default_rng(4)
        a, _ = render(["A"], self.units, seed=4)
        b, _ = render(["B", "A"], self.units, seed=5)
        chorus = rng.random((12, 24))
        chroma = np.concatenate([a, chorus, b], axis=1)
        alignment, found = self.detected(chroma)
        self.assertEqual([label for label, _ in found], ["A", "B", "A"])
        self.assertTrue(np.all(alignment.unit_of[a.shape[1] + 4 : a.shape[1] + 20] == -1))

    def test_intro_only_opens_the_piece(self):
        grille = dict(GRILLE, parts=[{"name": "Intro", "sequence": [["Eb"], ["Ebm6"], ["Bb/D"], ["C7"]]}, *GRILLE["parts"]])
        units = S.build_units(grille)
        by_label = {u.label: u for u in units}
        chroma, _ = render(["Intro", "A", "Intro", "B"], units, seed=10)
        alignment = S.align(chroma, units)
        labels = [label for label, a, b in S.segments(alignment, units) if label]
        self.assertEqual(labels[:2], ["Intro", "A"])
        self.assertNotIn("Intro", labels[2:])
        self.assertIn("Intro", by_label)

    def test_nothing_follows_the_coda(self):
        chroma, _ = render(["A", "Coda", "A"], self.units, seed=6)
        _, found = self.detected(chroma)
        labels = [label for label, _ in found]
        if "Coda" in labels:
            self.assertEqual(labels[-1], "Coda")


class SummarizeTest(unittest.TestCase):
    def setUp(self):
        self.units = S.build_units(GRILLE)

    def summarize(self, chroma):
        alignment = S.align(chroma, self.units)
        times = np.arange(chroma.shape[1] + 1) * 0.5
        return S.summarize(alignment, self.units, times)

    def test_full_form_is_confident(self):
        chroma, starts = render(["A", "A", "B", "B", "A", "C", "C2", "A"], self.units, seed=7)
        detection = self.summarize(chroma)
        self.assertEqual(detection.confidence, "high")
        self.assertEqual([s["part"] for s in detection.sections], list("AABBACCA"))
        self.assertAlmostEqual(detection.sections[1]["start"], starts[1] * 0.5, delta=K * 0.5)
        # Les passes s'enchaînent sans trou ni chevauchement.
        for previous, current in zip(detection.sections, detection.sections[1:]):
            self.assertEqual(previous["end"], current["start"])

    def test_missing_part_is_flagged(self):
        chroma, _ = render(["A", "A", "B", "B", "A"], self.units, seed=8)
        self.assertEqual(self.summarize(chroma).confidence, "low")

    def test_unrelated_audio_is_flagged(self):
        chroma = np.random.default_rng(9).random((12, 300))
        self.assertEqual(self.summarize(chroma).confidence, "low")


if __name__ == "__main__":
    unittest.main()
