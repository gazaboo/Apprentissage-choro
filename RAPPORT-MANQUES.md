# Rapport de manques — ajout des morceaux de `library/`

Branche `ajout-morceaux-library`. Évaluation précise de ce qui **n'a pas pu
être fait** en intégrant le dossier `library/` au répertoire de l'application.

Bilan : **24 morceaux ajoutés** (19 → 43 dans `web/public/data/manifest.json`),
**4 non intégrés**, **3 sans playback**, **1 partition à détection de mesures
cassée**, **0 grille d'accords produite**.

---

## 1. Morceaux non intégrés (4)

| Morceau | Contenu de `library/` | Raison |
|---|---|---|
| André de Sapato Novo — Jacob do Bandolim | `Andre do sapato Novo-clar-sib.mscz`, `-sax-tenor.mscz` | Aucun PDF ; seulement des fichiers MuseScore. Le pipeline ne traite que les PDF. |
| Chorando Baixinho — Abel Ferreira | `Chorando Baixinho-clar-sib.mscz` | Idem : seulement `.mscz`. |
| Desvairada — Garoto | `#6 - Desvairada - Play Along.mp3` | Aucune partition, seulement un MP3. |
| Gostosinho | `Copie de 25/26 Gostosinho.mp3/.wav` | Aucune partition, aucun compositeur identifié. |

Pour récupérer les deux premiers : ouvrir les `.mscz` dans MuseScore et
exporter en PDF (MuseScore 4 est installé : `mscore fichier.mscz -o sortie.pdf`),
puis les déposer dans `pdf-partitions/<Titre> - <Compositeur>/`.

---

## 2. Instruments manquants sur les morceaux intégrés

L'application se cale automatiquement sur l'instrument disponible ; l'absence
d'une transposition n'empêche rien, mais réduit l'usage.

### Sans partition Do (concert) — 3
| Morceau | Partition retenue | Détail |
|---|---|---|
| Apanhei-te cavaquinho | Si♭ | `library/` ne contient qu'une partie **Sax ténor** (donc en Si♭). Rangée en Si♭. |
| Cadencia | Si♭ | Le seul PDF « C » de `library/` est une **réduction piano scannée** (deux portées, grand-staff) — inexploitable pour la détection de mesures. Écarté. Reste le `Cadência_Bb.pdf` vectoriel. |
| Diplomata | Si♭ | `library/` ne contient qu'une partie clarinette Si♭ (+ un `.jpg` non exploitable). |

### Sans partition Mi♭ (14)
Apanhei-te cavaquinho, Araponga, Assim mesmo, Bionne, Cadencia, Começando,
Diplomata, Eu quero é sossego, Rio Antigo, Saxofone por que choras, Tamoyo,
Um a zero, Volúvel, Vou vivendo.
→ Raison : aucune partie Mi♭ dans `library/` (ni fichier séparé, ni section
dans un PDF combiné). Les combinés d'Olivier Lob de type `C_Bb_Eb_Fa` ont bien
fourni le Mi♭ (Feitiço, Lamentos, Nao me toques, Proezas, Sonhando, Um tom pra
jobim) ; les combinés `C_Bb` ou `C_flute_Bb` non.

### Récapitulatif instruments
| Instruments | Morceaux |
|---|---|
| Do + Si♭ + Mi♭ (10) | Bola preta, Clarinete melodia, Feitiço, Lamentos, Murmurando, Nao me toques, Proezas de solon, Sonhando, Ternura, Um tom pra jobim |
| Do + Si♭ (6) | Araponga, Assim mesmo, Bionne, Eu quero é sossego, Tamoyo, Vou vivendo |
| Do seul (5) | Começando, Rio Antigo, Saxofone por que choras, Um a zero, Volúvel |
| Si♭ seul (3) | Apanhei-te cavaquinho, Cadencia, Diplomata |

---

## 3. Playbacks manquants (3)

Aucune bande d'accompagnement fiable trouvée → `url-playback.md` absent, l'onglet
« Playback » est grisé et le lecteur se cale sur la référence.

| Morceau | Remarque |
|---|---|
| Bionne — Chiquinha Gonzaga | Pas de playback identifié (surtout des versions piano/vidéo-partition). |
| Tamoyo — Chiquinha Gonzaga | Idem. |
| Volúvel — Pattápio Silva | Un « Songbook playalong Pattápio Silva » existe (Choro Music) mais rien ne confirme qu'il couvre *Volúvel* précisément → écarté par prudence. |

Les 21 autres ont un playback (séries *BASES de CHORINHO*, *Chorando Baixinho*,
*Andy Carvalho Music*, *Choro Camp New England*, ou playback officiel du
compositeur pour *Começando*).

---

## 4. Références vidéo — points d'attention

Les 24 morceaux ont une URL de référence (`url.md`), toutes vérifiées joignables
(oEmbed 200). Choix discutables :

| Morceau | Référence retenue | Réserve |
|---|---|---|
| Apanhei-te cavaquinho | Arthur Moreira Lima, **piano** | Nazareth est un compositeur pour piano, mais ce n'est pas une version « regional / chorão ». |
| Assim mesmo | version « por Jacob do Bandolim » | Aucun enregistrement de Luiz Americano lui-même trouvé. |
| Diplomata | chaîne pédagogique « Choro Music » | Pas un enregistrement historique. |
| Clarinete melodia | version « Pitanga » | ✔ correspond exactement à la mention « Transcription de la Version Pitanga » portée sur la partition. |

---

## 5. Partitions de qualité dégradée

### Détection de mesures **cassée** — 1
- **Um a zero — Pixinguinha** : source = **scan image** (Songbook Irmãos Vitale).
  Le pipeline bascule sur le repli OpenCV → **344 « mesures » détectées sur
  2 pages** au lieu d'une soixantaine. La partition **reste lisible**, mais le
  mode « partition à trous par mesures » est inutilisable (masques trop nombreux
  et mal placés). Les modes vidéo / éclipses / partition entière fonctionnent.
  Réduite à la mélodie (pages 1‑2) ; le contracanto en clé de Fa (pages 3‑4) a
  été retiré. → *À remplacer par une gravure vectorielle ou un tracé de mesures
  manuel.*

### Détection de mesures **approximative** — arrangements à deux portées
Plusieurs partitions de `library/` sont des arrangements **mélodie + contrechant
/ baixaria sur deux portées** (et non des lead sheets à une portée comme le
reste du corpus). La détection produit des boîtes composites : comptes de
mesures approximatifs, parfois **incohérents entre transpositions**.

| Morceau | Symptôme |
|---|---|
| Lamentos | c = 156 mesures vs bb/eb = 26 (même arrangement, deux portées) |
| Clarinete melodia | ~18 mesures détectées seulement (« avec contrechant CT ») |
| Assim mesmo, Eu quero é sossego | deux portées, masquage grossier |

Lisibilité et transpositions correctes ; seul le granularité du masquage souffre.

### Retouches appliquées
- **Diplomata** : la source portait un bandeau « Edited by Foxit PDF Editor —
  For Evaluation Only » (tracé vectoriel, non supprimable par annotation). Page
  **recadrée** de 13 % en haut → bandeau retiré, tout le contenu musical
  conservé (le titre gravé de la partition est perdu, mais l'appli affiche son
  propre titre).
- **PDF combinés Olivier Lob** (Feitiço, Lamentos, Nao me toques, Proezas,
  Sonhando, Um tom pra jobim, Assim mesmo, Eu quero é sossego, Araponga) :
  découpés page à page avec `pymupdf` pour séparer Do / Si♭ / Mi♭ (section « Fa »
  en clé de Fa ignorée). Ordre des sections vérifié via l'armure de la 1ʳᵉ page.
- **Sonhando** : la source comporte des watermarks légers (« watermark »),
  visibles mais non gênants.
- **Volúvel** : le PDF `voluvel-c.pdf` de `library/` était un scan → détection
  cassée. Remplacé par `voluvel-grille.pdf` (lead sheet **vectoriel** propre,
  concert). Le `voluvel-bb.pdf` (scan également) a été abandonné → Volúvel est
  en Do seul.

---

## 6. Grilles d'accords

**Aucune grille produite** pour les 24 nouveaux morceaux
(`web/public/data/grilles/*.json`). Conséquence : la bascule
**Partition / Grille** reste masquée pour eux (dégradation déjà prévue par
l'appli). Les 19 morceaux d'origine gardent leurs grilles.
→ À transcrire manuellement dans un second temps (le README les marque déjà
« à vérifier »).

---

## 7. Titres / compositeurs à confirmer

| Entrée | À vérifier |
|---|---|
| **Clarinete melodia** — Guio de Morais | La partition est une « Transcription de la Version Pitanga (*Pitanga Faz Confusão No Choro*) ». Le titre réel du choro de Guio de Moraes pourrait différer de « Clarinete melodia ». |
| **Cadencia** — Juventino Maciel | Parfois orthographié « Joventino Maciel ». |
| **Ternura** — K-Ximbinho | Les PDF de `library/` sont étiquetés « Jacob do Bandolim » (erreur de la source) ; le compositeur est bien **K-Ximbinho**. Le dossier — donc l'appli — est correct. |
| **Murmurando** — Fon fon | Co-composé avec Mário Rossi. |
| **Vou vivendo**, **Um a zero**, **Proezas de solon**, **Lamentos** — Pixinguinha | Co-composés avec Benedito Lacerda (crédité sur certaines partitions). |

---

## 8. Non traité (hors périmètre)

`library/` contient aussi du **matériel supplémentaire pour des morceaux déjà
présents** dans l'appli, non intégré ici (périmètre = morceaux manquants
uniquement) :
- `E do que hà` : versions clarinette Si♭ « Duo », partie Mi♭ toujours absente ;
- `Sonoroso` : `Sonoroso - K. Ximbinho - Clarinet Bb.pdf` (l'appli n'a pas de Mi♭) ;
- `Cheguei`, `Naquele Tempo` : parties **contracanto** Si♭/Mi♭ séparées ;
- doublons de Benzinho, Carioquinha, Cochichando, Diabinho, Doce de Coco,
  Machucando, Migalhas, Noites cariocas, O Bom filho, Gaucho, Os cinco
  companheiros, Receita de Samba, Santa Morena, Vibrações, Tico tico.
