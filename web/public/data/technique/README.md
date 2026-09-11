# Arpèges et gammes — catalogue

`exercices.json` décrit les motifs à travailler. Chaque motif est écrit **une
seule fois**, dans la tonalité où il a été pensé ; l'application le transpose à
la lecture et en fait une carte de répétition espacée par tonalité et par sens.

Le fichier livré ne contient qu'un jeu de départ (arpège mineur, arpège
majeur, arpège de dominante, gammes). Il est fait pour être remplacé par les
motifs propres au répertoire — c'est le seul endroit à modifier pour changer
ce qu'on travaille.

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

### `roots`

Les tonalités engendrées, en noms de notes. **C'est le seul levier de volume du
catalogue** : un motif de quatre notes avec huit fondamentales et deux sens fait
seize cartes à réviser. Retirer une tonalité retire deux cartes. Absent, les
douze sont engendrées.

L'orthographe choisie ici décide de celle de la tonalité : `Eb` donne `Eb G Bb`,
`D#` donnerait `D# F## A#`. Écrivez comme vous lisez.

### `sens`

`montant`, `descendant`, `aller-retour` — une carte par entrée, car monter et
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
