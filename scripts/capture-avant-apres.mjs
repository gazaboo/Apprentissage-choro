#!/usr/bin/env node
// Compose une capture avant/après pour docs/fixes/, convention du projet :
// bordure orange = avant, bordure verte = après (cf. CLAUDE.md).
//
// Usage :
//   node scripts/capture-avant-apres.mjs <avant.png> <apres.png> <sortie.png>

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const COULEUR_AVANT = "#f97316"; // orange
const COULEUR_APRES = "#16a34a"; // vert
const EPAISSEUR_BORDURE = 12;
const ESPACEMENT = 16;

function usage() {
  console.error(
    "Usage: node scripts/capture-avant-apres.mjs <avant.png> <apres.png> <sortie.png>",
  );
  process.exit(1);
}

const [avant, apres, sortie] = process.argv.slice(2);
if (!avant || !apres || !sortie) usage();
for (const chemin of [avant, apres]) {
  if (!existsSync(chemin)) {
    console.error(`Fichier introuvable : ${chemin}`);
    process.exit(1);
  }
}

const dossierTmp = mkdtempSync(join(tmpdir(), "capture-avant-apres-"));

try {
  const hauteurs = [avant, apres].map((chemin) =>
    parseInt(
      execFileSync("magick", ["identify", "-format", "%h", chemin]).toString(),
      10,
    ),
  );
  const hauteurCible = Math.min(...hauteurs);

  const bordees = [
    [avant, COULEUR_AVANT, "avant.png"],
    [apres, COULEUR_APRES, "apres.png"],
  ].map(([source, couleur, nom]) => {
    const dest = join(dossierTmp, nom);
    execFileSync("magick", [
      source,
      "-resize",
      `x${hauteurCible}`,
      "-bordercolor",
      couleur,
      "-border",
      String(EPAISSEUR_BORDURE),
      dest,
    ]);
    return dest;
  });

  mkdirSync(dirname(sortie), { recursive: true });
  execFileSync("magick", [
    "montage",
    ...bordees,
    "-tile",
    "2x1",
    "-geometry",
    `+${ESPACEMENT}+0`,
    "-background",
    "white",
    sortie,
  ]);

  console.log(`Composite écrit : ${sortie}`);
} finally {
  rmSync(dossierTmp, { recursive: true, force: true });
}
