# Arpèges et gammes — catalogue

`exercices.json` décrit les motifs à travailler. Chaque motif est écrit **une
seule fois**, dans la tonalité où il a été pensé ; l'application le transpose à
la lecture et en fait une carte de répétition espacée par tonalité et par sens.

Le fichier livré contient un jeu de départ (arpèges, gammes) et la famille
**Dominantes** : une progression qui va de la gamme mixolydienne à la
résolution V7 → I / V7 → i, au ii–V–I et au cycle de dominantes (voir
`segments` plus bas). C'est le seul endroit à modifier pour changer ce qu'on
travaille.

## Format

```jsonc
{
  "description": "…",
  "exercices": [
    {
      "id": "arp-m7",            // identité stable : elle sert de clé SRS
      "famille": "Arpèges",      // titre de section dans l'interface
      "nom": "Arpège mineur 7",  // sous-titre
      "reference": "Dm7",        // chiffrage de la tonalité d'écriture
      "notes": ["D", "F", "A", "C"],
      "notes_descendant": ["D3", "Bb3", "A3", "F3"], // optionnel, voir plus bas
      "roots": ["D", "G", "A", "C", "F", "Bb", "E", "B"],
      "sens": ["montant", "descendant"],
      "note_de_travail": "Une note par clic, sans plaquer d'accord."
    }
  ]
}
```

### `notes`

Le motif dans l'ordre **ascendant**, en noms de notes. Les altérations s'écrivent
`#` ou `b` (`C#`, `Eb`, `Ebb`). L'orthographe compte : elle est reportée
telle quelle à la transposition, si bien que `Dm7` écrit `F` donnera `Ab` en fa
mineur et non `G#`.

Un motif propre au choro peut redescendre en son milieu. Dans ce cas seulement,
précisez l'octave (do central = `C4`) et elle sera respectée à la lettre :

```jsonc
"notes": ["D3", "F3", "A3", "C4", "A3", "F3"]
```

Sans octave, l'application les attribue elle-même : la fondamentale est placée
au plus bas de la tessiture de la guitare (mi grave), et chaque note monte
jusqu'à dépasser la précédente.

### `notes_descendant`

Optionnel. Au choro, l'arpège descendant n'est pas la montée rejouée à
l'envers — c'est une particularité du genre, pas une gamme qui redescend.
L'arpège mineur, par exemple, monte fondamentale-seconde-tierce mineure-quinte
mais descend fondamentale-sixte mineure-quinte-tierce mineure-fondamentale :
la montée fait quatre notes, la descente cinq — elle referme la phrase sur la
tonique.

Quand cette forme diffère de l'inverse de `notes`, écrivez-la ici, **avec
l'octave sur chaque note** (do central = `C4`) : la forme n'étant pas une
montée simple, l'application ne peut pas déduire seule le registre de chaque
note comme elle le fait pour `notes`.

```jsonc
"notes": ["D", "E", "F", "A"],
"notes_descendant": ["D3", "Bb3", "A3", "F3", "D3"]
```

Absent, la carte « descendant » rejoue `notes` à l'envers — le comportement
d'origine, toujours correct pour les gammes et les arpèges de dominante.

### `segments`

Optionnel. Une **phrase sur plusieurs accords** (« G7 → C ») : ses notes sont
rangées par accord, et remplacent alors `notes` (laissé absent).

```jsonc
{
  "id": "dom-dino-maj",
  "famille": "Dominantes",
  "nom": "5 · Baixaria V7 → I",
  "reference": "C",                // la **cible** : c'est sa tonalité que désigne `roots`
  "segments": [
    { "accord": "G7", "notes": ["G2", "B2", "G3", "F3"] },
    { "accord": "C",  "notes": ["E3"] }
  ],
  "roots": ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
}
```

- **Tous** les chiffrages sont transposés du même intervalle que la cible :
  en mi bémol, la carte s'intitule « Bb7 → Eb ».
- Le titre affiché reprend les accords distincts, dans l'ordre : une phrase
  qui alterne G7 et C huit fois s'intitule toujours « G7 → C ».
- L'**octave est obligatoire** sur chaque note (do central = `C4`) : une
  phrase redescend, le registre ne peut pas se deviner. La phrase transposée
  est ensuite recalée par octaves entières pour que sa note la plus grave
  soit la plus basse possible **à partir du fa dièse grave** : même registre
  dans les douze tonalités, et un mi dièse grave, dont le dièse déborderait
  sous la portée, n'est jamais écrit.
- Une phrase ne se joue que dans le sens écrit : une seule carte, de sens
  `phrase`, par tonalité (`sens` est ignoré). Une résolution jouée à l'envers
  n'en est plus une.
- Sur la portée, une barre légère sépare les accords, et le degré écrit sous
  chaque note se lit par rapport à l'accord qui sonne sous elle (le do de
  « G7 → C » est noté 1, pas 4).
- Dans les listes, la puce d'une tonalité affiche l'accord d'arrivée
  (« Ebm ») ; le chiffrage complet est dans son infobulle.

Neuf notes au plus par carte : c'est la largeur de référence de la portée,
vérifiée sur tout le catalogue par `portee.unit.test.ts`.

### `roots`

Les tonalités engendrées, en noms de notes. **C'est le seul levier de volume du
catalogue** : un motif de quatre notes avec huit fondamentales et deux sens fait
seize cartes à réviser. Retirer une tonalité retire deux cartes. Absent, les
douze sont engendrées.

L'orthographe choisie ici décide de celle de la tonalité : `Eb` donne `Eb G Bb`,
`D#` donnerait `D# F## A#`. Écrivez comme vous lisez.

### `sens`

`montant`, `descendant`, `aller-retour` (et `phrase`, réservé aux `segments`)
— une carte par entrée, car monter et
descendre ne s'acquièrent pas ensemble. `aller-retour` joue le motif puis son
miroir, sans rejouer le sommet — sauf si `notes_descendant` est renseigné :
la carte joue alors la montée suivie telle quelle de la vraie descente, au
lieu de la montée rejouée à l'envers. C'est le cas des arpèges choro, où la
descente est une forme à part entière (voir `arp-m`, `arp-maj`).

Absent, `["montant", "descendant"]` est retenu.

## Ce que l'application en fait

- une carte SRS par tonalité et par sens, sous la clé `tech::<id>::<tonalité>::<sens>` ;
- le chiffrage transposé est le seul texte affiché en grand ; les noms de notes
  sont l'**indice**, révélé sur demande, et chaque appui est compté ;
- les hauteurs MIDI servent à la détection au micro, qui compare ce qui est
  joué à ce qui est attendu.

Un fichier absent ou mal formé fait simplement disparaître la section
« Arpèges et gammes » : l'application démarre normalement sans lui. Un motif
individuellement invalide est ignoré, les autres sont conservés.
