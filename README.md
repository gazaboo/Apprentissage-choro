# Entraînement et mémorisation active — répertoire de choros

Outil de travail instrumental appliquant cinq principes issus des sciences
cognitives de l'apprentissage musical : **retrieval practice** (partition à
trous), **performance cues**, **interleaving**, **démarrages à froid** et
**répétition espacée**.

Site statique : la progression vit dans le `localStorage` du navigateur, et
peut être **synchronisée entre appareils** via une unique fonction Netlify
(Netlify Blobs) — voir « Synchronisation ».

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

### 3. Déploiement Netlify

`netlify.toml` à la racine décrit tout : build de `web/`, publication de
`web/dist/`, et la fonction `netlify/functions/sync.mjs`. Le `package.json`
racine ne sert qu'à fournir `@netlify/blobs` au bundle de la fonction.

Les partitions générées (`web/public/data/`, ~19 Mo) sont **versionnées** : le
build Netlify n'exécute pas le pipeline Python. Après un
`python scripts/preprocess_all.py` qui ajoute ou modifie des morceaux, penser à
`git add web/public/data`.

```bash
npm install          # à la racine : dépendance de la fonction
npx netlify dev      # app + fonction en local (store Blobs sandboxé)
npx netlify deploy   # déploiement
```

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

## Interface

**Aucun raccourci clavier.** L'outil s'adresse à des musiciens, pas à des
utilisateurs de clavier : chaque action a un bouton libellé, visible sans rien
avoir appris. Tous les contrôles font au moins 44 × 44 px, pour être atteints
d'une main, l'instrument dans l'autre.

**Lecteur audio seul.** L'iframe YouTube est déportée hors du champ de vision
(`left: -9999px`, 1 × 1 px — jamais `display: none` ni `visibility: hidden`, qui
coupent le son sur certains navigateurs) et pilotée par l'API IFrame. La vidéo
n'apprend rien à qui travaille d'oreille ; seul l'audio compte.

**Barre de transport** — lecture/pause, défilement, **avec ou sans la mélodie**,
vitesse (0,5× / 0,75× / 1×), et derrière un bouton « Réglages » : comment
travailler, votre instrument, répéter un passage, se mettre à l'épreuve.

**Avec / Sans mélodie** est dans la barre, et non dans les réglages, parce que
c'est un aller-retour constant et non un choix qu'on pose une fois :
l'accompagnateur (guitare, cavaquinho) travaille sur l'enregistrement complet,
le soliste sur l'accompagnement seul — mais il revient au thème pour se le
remettre en tête. La bascule enchaîne la lecture sans nouveau geste ; la
position, elle, n'est pas reportée, deux enregistrements différents ne plaçant
pas le même instant au même endroit du morceau.

Sous 1024 px, la piste occupe une première ligne à elle seule et les commandes
se rangent dessous : les trois groupes ne tiennent pas côte à côte sur un
téléphone sans réduire la piste à un trait.

Sur grand écran, les réglages s'ouvrent dans un **popover étroit et
déplaçable** : la partition reste visible à côté, si bien qu'on voit l'effet de
chaque réglage au moment où on le touche, et l'on pousse le panneau là où il ne
gêne pas. Sa position est mémorisée, et bornée à la fenêtre — sans quoi un
panneau laissé au bord d'un grand écran serait inatteignable sur un plus petit.
Sur téléphone, les mêmes réglages s'ouvrent par le bas, à la hauteur de leur
contenu.

Chaque réglage porte un titre en langue courante et, s'il en a besoin, une
phrase disant à quoi il sert. Le vocabulaire de conception — *ghost mode*,
*cold start*, *A-B loop*, *performance cues* — reste dans ce README et dans le
code ; il ne remonte jamais dans l'interface.

**Répéter un passage** — nommé par l'intention, jamais « boucle A-B » : le
public visé ne cherche pas un mécanisme, il cherche à faire tourner un endroit
difficile. Deux gestes, au choix :

- **tracer** le passage sur une frise du morceau, qui porte son mode d'emploi en
  clair tant qu'elle est vide (« Glissez ici pour choisir le passage à
  répéter ») ; ses deux bords se tirent pour l'ajuster, et **la bande elle-même
  se saisit** pour déplacer le passage sans en changer la durée — le geste
  courant quand on s'est trompé d'une mesure ;
- **marquer au vol** pendant que ça joue, avec un bouton unique dont le libellé
  annonce toujours l'appui suivant : *Le passage commence ici* → *Le passage
  finit ici* → *Arrêter de répéter*. C'est le fonctionnement d'une pédale de
  boucle, déjà familier aux musiciens.

Sur grand écran, la frise se colle **sous la piste de lecture**, alignée sur
elle : les poignées tombent juste à côté de ce qu'elles désignent. Sur
téléphone elle serait illisible à cette taille et retourne dans le panneau, à
pleine hauteur tactile.

Les bornes s'affichent « Début » et « Fin », et s'ajustent de 0,5 s au tap, 2 s
à l'appui long — indispensable pour caler le passage sur le temps fort, en
l'absence de tout repère structurel : le manifeste ne contient pas de
timestamps. Le bouclage est maison : la position est sondée toutes les 100 ms,
et la lecture ramenée au début dès qu'elle dépasse la fin.

**Ce que la boucle donne à voir** — hors du passage, la barre de défilement est
assombrie ; le passage reste éclairé, encadré de deux repères. Un badge résume
`🔁 0:38 – 1:45 · 3 fois`, et un éclair bref parcourt le segment à chaque
retour au début : le rebouclage s'entend, il doit aussi se voir.

**Reprendre au hasard** — saut à un instant imprévu, décompte 3 · 2 · 1, puis
lecture (*cold start*). **Écoute aveugle** — masque la position et la durée :
sans repère visuel, on ne peut plus anticiper la structure.

---

## Masquage et répétition espacée

**Quatre modes**, présentés comme une échelle de difficulté, et non comme un
empilement d'options :

- **Partition entière** — rien n'est caché : lecture et repérage.
- **Mesures cachées** — des mesures sont recouvertes (25, 50 ou 75 %). Un tap en
  révèle une pendant **5 secondes**, puis elle se re-masque seule. Le retour
  automatique est le cœur du dispositif : il empêche de transformer l'indice en
  lecture passive.
- **Éclipses** — la partition disparaît **entièrement**, par surprise, pendant
  quelques secondes, avec un décompte au centre de l'écran. Là où les mesures
  cachées travaillent la mémoire locale (*que vient-il ici ?*), les éclipses
  travaillent la continuité : privé de la page en plein milieu d'une phrase, il
  faut continuer plutôt que s'arrêter, et le retour de la partition donne
  aussitôt le verdict. Trois intensités règlent d'un seul geste la fréquence et
  la durée (douces : une toutes les 25 à 40 s, 4 à 8 s ; intenses : toutes les 8
  à 15 s, 14 à 22 s). Une éclipse ne survient que lorsqu'on joue réellement —
  sans quoi elle tomberait pendant qu'on règle la vitesse, l'instrument posé.
  Le bouton **Revoir la partition** l'interrompt avant la fin, et se compte comme
  un indice.
- **Sans partition** — aucune page n'est rendue : à l'oreille et de mémoire.

En mode *Mesures cachées*, le tirage est **aléatoire** à une réserve près : les
débuts de système sont épargnés tant que le taux le permet. Ce sont les
*performance cues*, les points de reprise auxquels on se raccroche quand la
mémoire lâche. Le motif est **stable d'un chargement à l'autre** (la graine est
mémorisée), et le bouton **Mélanger** le renouvelle.

Les masques sont en **verre dépoli clair** (blanc très légèrement chaud à 96 %
+ `backdrop-filter`) plutôt qu'en noir plein : sur du papier blanc, un panneau
anthracite lit comme un défaut d'impression, alors qu'un calque à peine teinté
lit comme une feuille posée sur la page. Un filet d'encre pâle et une ombre
courte le décollent du papier.

**Note suggérée** : quel que soit le mode, le questionnaire compare le nombre de
fois où l'on a eu besoin de la partition au nombre de fois où elle était
dérobée — mesures révélées sur mesures cachées, ou éclipses interrompues sur
éclipses survenues. Le rapport garde le même sens, `suggestGrade()` est
inchangée.

**SRS** : variante de SM-2 modulée par l'aisance technique — un morceau récité
de mémoire mais injouable au tempo revient plus tôt (× 0,7 en sous-tempo,
× 0,85 crispé, × 1,0 fluide). Stockage sous la clé `choro-srs-v1`, indexé par
`morceau::instrument`.

## Setlists et séances

Pour préparer un concert, on cadre le travail sur un sous-ensemble du
répertoire. `#/setlists` permet d'en créer, d'en supprimer et d'en **activer**
une (dates facultatives, purement indicatives). Le tableau de bord porte un
**menu déroulant** de setlist — « Tout le répertoire » y est une entrée comme
une autre (elle correspond à `activeSetlistId = null`) — avec l'aperçu des
5 premiers titres, dépliable. Le périmètre choisi restreint la liste des
morceaux **et** les séances ; le SRS décide de l'ordre à l'intérieur.

**Trois façons de travailler la setlist active**, depuis « Session du jour » :

- **Travail de fond** — les morceaux s'enchaînent dans l'ordre SRS (du plus au
  moins en retard), une évaluation par morceau, **jusqu'à arrêt**. Pas de
  minuteur : on travaille chaque pièce à fond. Après le dernier morceau, l'ordre
  est recalculé et la rotation reprend.
- **Révision des urgences** — les 3 morceaux les plus en retard, en rotation
  alternée (A → B → C → A → B → C) par blocs de 5 minutes. On quitte chaque
  pièce avant qu'elle ne soit confortable : le retour force une vraie
  récupération en mémoire.
- **Filage** — la setlist **dans son ordre**, comme un filage de concert. Un
  seul bouton mène à un écran de préparation : **partition affichée** (Ut / C,
  Si♭ / B♭ ou Mi♭ / E♭) et **bande** (enregistrement original ou playback).
  Au lancement, un **décompte de 10 secondes** affiche tout l'ordre de passage,
  le temps de prendre son instrument (écourtable d'une touche ou d'un clic).
  Chaque morceau joue avec la bande choisie, puis un **décompte de 5 secondes**
  annonce le suivant avant que la lecture ne reprenne seule. Enchaînement
  automatique à la fin de l'audio, ou bouton « Passer au suivant ». Barre de
  lecture, vitesse **et choix de bande** restent accessibles en continu ; la
  partition (masquable) laisse place, sinon, à une **vue « scène »** : titre en
  grand et prochains morceaux.

Chaque séance menée est consignée (`progress.sessions`) : le tableau de bord
montre la date de la dernière et, sur demande, les dix dernières. Les setlists
et l'historique vivent dans la clé `choro-srs-v1`, à côté des cartes SRS.

## Synchronisation

À la première arrivée, une **passerelle d'accueil** propose deux voies :
travailler *sur cet appareil* (progression locale) ou *sur tous ses appareils*
en choisissant un **identifiant**. Le choix est mémorisé ; l'en-tête affiche
l'identifiant connecté (ou « Anonyme »), et `#/compte` permet de se
connecter / déconnecter.

À la saisie d'un identifiant, l'app interroge `netlify/functions/sync.mjs` :
- **connu** (200) → connexion et rechargement automatiques de l'état ;
- **inconnu** (404) → on demande s'il faut créer un nouvel espace ;
- **hors ligne** → message d'erreur.

L'identifiant (secret choisi par l'utilisateur, le même sur chaque appareil ;
« code de synchro » dans le code) sert de clé à un unique blob JSON dans Netlify
Blobs. Au chargement et au retour au premier plan, l'app récupère l'état distant
et le **fusionne sans rien perdre** : chaque carte SRS est réconciliée
séparément (la plus récemment révisée gagne), l'historique des séances est
unionné par date, et les blocs non fusionnables — réglages, setlists — suivent
l'appareil au dernier enregistrement (`_rev`). Chaque enregistrement local
programme un envoi différé de 3 s. **Aucun bouton de synchro** : tout est
automatique. Hors ligne, l'app reste pleinement utilisable et la synchro reprend
au retour du réseau.

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
  public/data/                généré (versionné) — images + manifest.json
  src/
    main.ts                   routage et orchestration
    store.ts srs.ts session.ts
    sync.ts                   synchro entre appareils + fusion (fonction pure)
    youtube.ts                lecteur audio seul, ticker, répétition de passage
    transport.ts sheet.ts     barre de transport et panneau de réglages
    eclipse.ts                horloge des éclipses
    score.ts dom.ts
    views/dashboard.ts views/trainer.ts views/srsModal.ts
    views/setlists.ts         CRUD des setlists
    views/filage-config.ts    préparation du filage : partition + bande
    views/filage.ts           filage de la setlist, audio enchaîné + décompte
    views/account.ts          passerelle d'accueil + gestion de la synchro
netlify/
  functions/sync.mjs          GET (200 / 404) et PUT d'un blob JSON par identifiant
netlify.toml package.json      config de déploiement + dépendance de la fonction
```

## Écarts assumés par rapport à la spécification initiale

- **`pdf2image` n'est pas utilisé** : PyMuPDF assure à la fois le rendu et
  l'extraction vectorielle, ce qui retire une dépendance et le besoin de
  poppler. `opencv-python` et `numpy` restent, pour le repli raster.
- **Vitesses de lecture 0,85× et 1,05× impossibles** : le lecteur YouTube
  n'accepte que les paliers de `getAvailablePlaybackRates()`. L'interface
  propose 0,5× / 0,75× / 1×, applique le palier disponible le plus proche et
  affiche la vitesse réellement obtenue.
- **Pas de zones tactiles de transport sur la partition** : elles entreraient en
  conflit avec l'indice éphémère, qui occupe déjà le tap sur une mesure masquée.
  Le transport reste entièrement dans sa barre.
