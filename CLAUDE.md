# Consignes projet

## Workflow Git — obligatoire

- **Toute modification se fait sur une branche dédiée.** Ne jamais committer
  directement sur `main`.
- **Tout passe par une pull request.** Après avoir poussé une branche, ouvrir
  une PR vers `main` ; ne pas pousser sur `main` ni la fusionner en local.
- Une branche = un sujet (un fix, une fonctionnalité, une issue). Nommage :
  `fix/…`, `feat/…`, `chore/…`, `docs/…`.
- Lier l'issue correspondante dans la PR (`Closes #N`).

## Vérification

- Avant d'ouvrir une PR : `cd web && npm run build` (tsc + vite) **et**
  `npm test` (vitest) doivent passer.
- **Logique pure** (calculs, transformations de données) : couvrir par un
  test vitest (`web/src/**/*.test.ts`) plutôt que vérifier via un cycle
  navigateur complet — voir `web/src/technique/catalogue.test.ts` pour un
  exemple (régression du bug d'octave des arpèges, PR #38). Si l'écrire en
  test n'est pas rentable pour un cas isolé, un script Node jetable qui
  appelle directement la fonction reste l'alternative. Dans les deux cas,
  vérifier plusieurs cas (ex. plusieurs tonalités transposées, pas seulement
  le cas de référence).
- **Visuel** : piloter Chromium headless en CDP (l'extension Chrome n'est
  pas connectée), via les aides de `scripts/cdp-verify.mjs`
  (`launchChromium`, `openTab`, `connect`, `setViewport`, `evaluate`,
  `clickSelector`, `screenshot`, `stopChromium`…) plutôt que réécrire le
  protocole à la main — elles encodent les pièges déjà rencontrés (verbe
  PUT sur `/json/new`, viewport par défaut trop petit, clic JS insuffisant
  pour un geste de confiance, etc.). Pendant le debug, lire l'état via
  `evaluate` (DOM/texte/JSON) plutôt que des captures ; réserver la capture
  d'écran à la vérification finale.
- **Toute PR doit être démontrée par une capture d'écran quand le cas s'y
  prête** (changement visible dans l'UI, même indirectement). Composite
  avant/après : `node scripts/capture-avant-apres.mjs avant.png apres.png
  docs/fixes/nom.png` (bordure orange = avant, verte = après ; capture
  simple sinon). Joindre le résultat dans `docs/fixes/` et le référencer via
  l'URL `raw.githubusercontent.com` **épinglée au SHA du commit** qui
  l'ajoute (`…/Apprentissage-choro/<sha>/docs/fixes/nom.png`), jamais au
  nom de la branche : les branches sont supprimées automatiquement à la
  fusion, ce qui casserait l'image. Si la PR ne touche à rien
  de visible (refacto pur, script, doc, données sans effet visuel), l'omettre
  est acceptable — mais le dire explicitement dans la description de la PR
  plutôt que de l'oublier silencieusement.
- **Cette règle vaut aussi pour chaque commit supplémentaire poussé sur une
  PR déjà ouverte** (retour de relecture, correction demandée, etc.), pas
  seulement à la création de la PR : si ce commit change quelque chose de
  visible, joindre une nouvelle capture (avant/après si pertinent) dans
  `docs/fixes/` et la référencer dans le commentaire de mise à jour sur la
  PR — ne pas se contenter d'un commentaire textuel. Même exception que
  ci-dessus si le commit ne touche à rien de visible, à condition de le
  dire explicitement.

## Budget / contexte

- **Ne jamais lire directement un PDF** de `pdf-partitions/` ou `library/`
  (coût élevé en tokens vision) : passer par `scripts/preprocess_all.py` et
  ne lire que sa sortie texte/JSON.
- Sur les gros fichiers (`web/src/views/*.ts`, `transport.ts`, `grille.ts`…),
  chercher (`grep`) avant de lire, puis `Read` ciblé (offset/limit) plutôt
  que le fichier entier.
- Recherche exploratoire (« où est géré X ») : déléguer à un sous-agent
  plutôt que de faire remonter la sortie brute dans le contexte principal.
- `README.md` est long : lire la section pertinente, pas le fichier entier.

## Données

- `web/public/data/` est **versionné** (build Netlify sans pipeline Python).
  Après `preprocess_all.py`, faire `git add web/public/data`.
