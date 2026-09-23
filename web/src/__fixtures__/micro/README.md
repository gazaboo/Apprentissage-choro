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

| Prise | Joué | Conditions | Justes, avant → après réglage |
|---|---|---|---|
| `gamme-c` | Gamme de do C2 → C4 | jeu libre, **micro saturé** | 2/16 → 13/16 |
| `arpege-am` | Arpège Am aller-retour × 2 | jeu libre, **micro saturé** | 2/19 → 15/19 |
| `gamme-c-2` | Gamme de do × 2 (~0,35 puis ~0,25 s/note) | jeu libre, micro baissé | 5/28 → 20/28 |
| `arpege-am-2` | Arpège Am, 1 lent + 4 rapides (~0,2–0,3 s/note) | jeu libre, micro baissé | 8/37 → 28/37 |
| `gamme-c-eval` | Gamme de do, 84 bpm | **évaluation**, métronome au haut-parleur | 3/23 → 18/23 |
| `arpege-am-eval` | Arpège Am, 60 bpm | **évaluation**, métronome au haut-parleur | 2/17 → 16/17 |

Toutes : Firefox, guitare 7 cordes. `justesMin` (dans `.verite.json`) est le
plancher que `npm test` exige — il ne doit que monter.

Les prises d'évaluation contiennent aussi les quatre clics du décompte,
entendus par le micro : `latence.unit.test.ts` y mesure 97 et 99 ms de latence
aller-retour, là où le navigateur annonce 42 ms.

La vérité terrain (`.verite.json`) a été établie hors ligne :
- attaques par flux spectral (ou enveloppe pour les premières prises) ;
- hauteur par produit spectral harmonique sur une fenêtre prise après
  l'attaque (hors écrêtage), recoupée avec le motif joué ;
- notes où le spectre contredit le motif sans pouvoir trancher marquées
  `incertain` : ni justes ni fausses au score. Le musicien apprend et peut
  se tromper — le motif seul ne vaut pas preuve.
- `sature` : l'alerte de saturation doit-elle se déclencher sur la prise.
