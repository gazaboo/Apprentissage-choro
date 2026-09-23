# Prises réelles du micro

Enregistrements faits avec une vraie guitare, pour régler et verrouiller la
détection de hauteur (`web/src/pitch.ts`) sur autre chose que des signaux
synthétiques.

## Enregistrer une prise

1. Ouvrir l'app avec `?debug=micro` **avant** le `#` :
   `https://…/?debug=micro#/technique`.
2. Lancer une séance, puis « Tester le micro » (jeu libre) ou « Évaluer »
   (au métronome : les battues sont alors consignées aussi).
3. Jouer une séquence connue, puis « Télécharger le diagnostic micro » :
   un `.wav` (signal brut, avant les coupe-bandes) et un `.json` (réglages du
   micro, latences, notes détectées et instant où elles sont sorties, battues,
   notes attendues).
4. Déposer les deux fichiers ici, sous le même nom, et noter dans ce README ce
   qui a réellement été joué.

## Rejouer

`npm test` rejoue chaque `.wav` dans `PitchStream` (`micro-replay.ts`, mêmes
lots et mêmes filtres que la page) et écrit à côté un `.rapport.txt`
(non versionné).

## Prises

| Prise | Joué | Conditions | Détection au 2026-09-23 |
|---|---|---|---|
| `gamme-c` | Gamme de do C2 → C4 (précédée d'un E2) | Firefox, 60 bpm, jeu libre, **micro saturé** (≈ 6 % d'échantillons écrêtés, 78 % sur certaines attaques) | 2/16 |
| `arpege-am` | Arpège Am aller-retour × 2 | idem | 2/19 |

La vérité terrain (`.verite.json`) a été établie hors ligne : attaques sur
l'enveloppe, hauteur par produit spectral harmonique sur 400 ms prises 350 ms
après l'attaque (hors écrêtage), puis contrôlée contre l'exercice. `sature`
y dit si l'alerte de saturation doit se déclencher sur la prise.
