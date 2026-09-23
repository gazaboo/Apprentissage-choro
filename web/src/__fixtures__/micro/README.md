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
