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

- Le projet n'a **aucune suite de tests**. Avant d'ouvrir une PR :
  `cd web && npm run build` (tsc + vite) doit passer.
- Vérification visuelle : piloter Chromium headless en CDP (l'extension Chrome
  n'est pas connectée). Pour une PR de correctif UI, joindre une capture
  avant/après dans `docs/fixes/` (composite ImageMagick, bordure orange =
  avant, verte = après) et la référencer via l'URL `raw.githubusercontent.com`
  de la branche.

## Données

- `web/public/data/` est **versionné** (build Netlify sans pipeline Python).
  Après `preprocess_all.py`, faire `git add web/public/data`.
