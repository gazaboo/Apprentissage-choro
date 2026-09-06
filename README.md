# Entraînement et mémorisation active — répertoire de choros

Outil de travail instrumental appliquant cinq principes issus des sciences
cognitives de l'apprentissage musical : **retrieval practice** (partition à
trous), **performance cues**, **interleaving**, **démarrages à froid** et
**répétition espacée**.

Site 100 % statique : aucun serveur, toute la progression vit dans le
`localStorage` du navigateur.

---

## Mise en route

### 1. Prétraitement des partitions (Python)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt

python scripts/preprocess_all.py
```

Le script parcourt `pdf-partitions/`, rastérise chaque page en WebP 300 DPI,
détecte les mesures et écrit le tout dans `web/public/data/`.

| Option | Effet |
|---|---|
| `--source DIR` | dossier des PDF (défaut `pdf-partitions`, casse indifférente) |
| `--out DIR` | dossier de sortie (défaut `web/public/data`) |
| `--dpi N` | résolution de rendu (défaut 300) |
| `--only TEXTE` | ne retraiter que les morceaux correspondants ; le manifeste existant est **complété**, pas écrasé |
| `--debug` | écrit un `page_N.debug.png` par page, avec portées, barres et boîtes tracées |
| `--force-raster` | force le pipeline OpenCV (test du repli) |
| `--clean` | vide le dossier de sortie d'abord (incompatible avec `--only`) |

### 2. Application web

```bash
cd web
npm install
npm run dev            # développement
npm run build          # build statique dans web/dist/
npx serve dist         # vérification du build
```

`base: './'` : `dist/` est déployable tel quel, à la racine d'un domaine comme
dans un sous-dossier (GitHub Pages, Cloudflare Pages, `npx serve`).

---

## Détection des mesures

Les 53 PDF du corpus sont des **gravures vectorielles natives** (MuseScore,
Finale, exports PostScript) — aucun scan. Le pipeline exploite donc la
géométrie du document plutôt que de deviner sur une image :

1. **Lignes de portée** — segments horizontaux fins et continus, regroupés par
   cinq à interligne régulier. Un filtre de *contiguïté* écarte les alignements
   fortuits d'arêtes de barres de croches, qui couvrent la largeur de page mais
   en laissant des trous.
2. **Barres de mesure**, par deux signaux exclusifs :
   - MuseScore *interrompt* ses lignes de portée à chaque barre : les coupures
     sont les frontières, au point près (retenues si trois lignes sur cinq les
     corroborent) ;
   - Finale et les exports PostScript tracent des lignes continues : on
     détecte alors les traits verticaux dont les **deux** extrémités épousent
     la portée à 0,25 pt près. Sur le corpus, une vraie barre tombe à moins de
     0,15 pt des deux lignes extrêmes tandis que la hampe de note la plus
     proche en est déjà à 0,5 pt — c'est ce qui les sépare.
3. **Repli OpenCV** (`raster_geometry.py`) — redressement par transformée de
   Hough puis morphologie mathématique. Il ne se déclenche que si l'extraction
   vectorielle ne trouve aucune portée (partition scannée). Sur ce corpus il
   n'est jamais sollicité ; `--force-raster` permet de l'exercer.

Chaque mesure produit une **boîte composite** englobant la portée *et* la
grille d'accords chiffrés au-dessus (padding de 1,4 hauteur de portée), bornée
au milieu de l'écart avec le système voisin pour que deux masques ne se
chevauchent jamais. Les coordonnées sont normalisées de 0.0 à 1.0.

> Contrôle visuel : `--debug` puis ouvrir un `page_N.debug.png` — rouge = boîte
> retenue, bleu = étendue de portée, vert = barre détectée.

---

## Tolérance aux données manquantes

Rien n'est obligatoire dans un dossier de morceau. Le pipeline signale et
poursuit ; l'interface s'adapte sans jamais planter :

| Manque | Comportement |
|---|---|
| `url.md` absent ou vide | `reference: null` → le lecteur se cale sur le playback, l'onglet Référence est grisé « (Non disponible) » |
| `url-playback.md` absent ou vide | cas symétrique |
| aucune des deux URL | bandeau « Aucune vidéo disponible » ; l'entraînement sur partition reste utilisable |
| une seule partition | le sélecteur de transposition disparaît au profit d'une simple mention |
| deux PDF pour un même instrument | avertissement listant les fichiers, le mieux nommé est retenu |

État actuel du corpus : `Tico tico no fubá` n'a pas de référence,
`Naquele Tempo` et `Doce de Coco` n'ont pas de playback, `E do que hà` et
`Sonoroso` n'ont pas de partie Mi♭.

---

## Raccourcis clavier

Pensés pour être atteints sans lâcher l'instrument.

| Touche | Action |
|---|---|
| `Espace` | Lecture / Pause |
| `P` | Basculer Référence ↔ Playback |
| `H` | Indice éphémère : la mesure s'éclaircit **2 s** puis se re-masque |
| `J` | Saut à froid, avec décompte 3 · 2 · 1 |
| `G` | Ghost mode — masque l'image, garde l'audio |
| `T` | Transposition suivante (sans couper la lecture) |
| `1` – `5` | Note dans le questionnaire d'auto-évaluation |
| `?` | Aide |

Les raccourcis sont liés au **code physique** des touches : ils restent au même
endroit en AZERTY comme en QWERTY, et sont neutralisés dans les champs de saisie.

---

## Masquage et répétition espacée

**Trois paliers**, qui ne diffèrent pas que par la quantité :

- **25 %** — cadences et fins de phrases, là où se joue la résolution harmonique ;
- **50 %** — damier, une mesure sur deux ;
- **80 %** — tout sauf les repères cardinaux (débuts de système et jalons
  réguliers) : ce sont les *performance cues*.

Le motif est **déterministe** (dérivé de l'identifiant du morceau, de
l'instrument et du palier) : on révise les mêmes trous d'une session à l'autre
plutôt que de redécouvrir une partition différente à chaque chargement.

**SRS** : variante de SM-2 modulée par l'aisance technique — un morceau récité
de mémoire mais injouable au tempo revient plus tôt (× 0,7 en sous-tempo,
× 0,85 crispé, × 1,0 fluide). Stockage sous la clé `choro-srs-v1`, indexé par
`morceau::instrument`.

**Session entrelacée** : les 2 ou 3 morceaux les plus en retard sont travaillés
en rotation alternée (A → B → A → B), par blocs de 5 minutes. On quitte chaque
pièce avant qu'elle ne soit confortable : le retour force une vraie
récupération en mémoire plutôt qu'un maintien en mémoire de travail.

---

## Structure

```text
scripts/
  preprocess_all.py           CLI
  choro_preprocess/
    scan.py                   arborescence → morceaux, URLs, PDF catégorisés
    vector_geometry.py        détection vectorielle (PyMuPDF) — moteur principal
    raster_geometry.py        détection OpenCV (Hough + morphologie) — repli
    measures.py               portées → boîtes composites normalisées
    render.py                 rendu WebP et calques de contrôle
    manifest.py               sérialisation JSON
web/
  public/data/                généré — images + manifest.json
  src/
    main.ts                   routage et orchestration
    store.ts srs.ts session.ts
    youtube.ts score.ts keyboard.ts dom.ts
    views/dashboard.ts views/trainer.ts views/srsModal.ts
```

## Écarts assumés par rapport à la spécification initiale

- **`pdf2image` n'est pas utilisé** : PyMuPDF assure à la fois le rendu et
  l'extraction vectorielle, ce qui retire une dépendance et le besoin de
  poppler. `opencv-python` et `numpy` restent, pour le repli raster.
- **Vitesses de lecture 0,85× et 1,05× impossibles** : le lecteur YouTube
  n'accepte que les paliers de `getAvailablePlaybackRates()`. L'interface
  propose 0,5× / 0,75× / 1× / 1,25×, applique le palier disponible le plus
  proche et affiche la vitesse réellement obtenue.
