# Grilles d'accords — transposition Ut / C

Une grille par morceau (`<song-id>.json`), transcrite **à la vue** depuis les
partitions `data/<song-id>/c/page_*.webp` par Claude (Sonnet 5).

> ⚠️ **À vérifier avant de s'y fier.** La suite et la nature des accords sont
> fiables ; l'**alignement mesure par mesure** et le **découpage des barres à
> deux accords** sont approximatifs, surtout dans les passages arpégés où peu
> de chiffrages sont écrits. Chaque fichier porte un champ `notes` signalant
> ses points incertains et un `confidence` global.

## Format

```jsonc
{
  "song_id": "benzinho-jacob-do-bandolim",
  "title": "Benzinho",
  "composer": "Jacob do Bandolim",
  "transposition": "c",          // Ut / C
  "meter": "2/4",
  "parts": [
    {
      "name": "A",
      "tonic": "Dm",             // centre tonal de la partie
      "bars": "1–32",            // plage de mesures dans la partition
      "repeat": true,
      "sequence": [              // une entrée par mesure écrite
        ["Dm"],                  //   1 accord
        [],                      //   [] = on tient l'accord précédent
        ["A7/E", "A7/C#"]        //   2 accords dans la mesure
      ],
      "endings": {               // facultatif : 1re / 2e fin
        "1": [["Dm"], ["A7"]],
        "2": [["Dm"], ["C7"]]
      }
    }
  ],
  "form": "A B A(Coda)",         // ordre de jeu, si repérable
  "notes": ["mm. 25-28 : trois accords resserrés, découpage à confirmer"],
  "confidence": "medium",        // high | medium | low
  "source": ["data/benzinho-jacob-do-bandolim/c/page_1.webp", "…"]
}
```

`index.json` liste tous les morceaux couverts.

## Ce que l'application affiche

**Écrivez ici le chiffrage complet ; l'application le simplifie à l'affichage.**
Ces fichiers restent la transcription fidèle de la partition — c'est ce qui
permet de les relire face au papier, et de changer d'avis plus tard sur la
simplification sans les réécrire.

La grille sert à accompagner, pas à relever. Elle ne montre donc que cinq
formes :

| Écrit dans le fichier | Affiché | Pourquoi |
|---|---|---|
| `A7/C#`, `Cm/Eb`, `G/F` | `A7`, `Cm`, `G` | La basse d'un renversement ne change pas l'accord de la main gauche. |
| `Gm6`, `Gm7`, `Gm(maj7)` | `Gm` | Repliés sur la famille mineure. |
| `D6`, `Dmaj7`, `D(#5)` | `D` | Repliés sur la famille majeure. |
| `F7#5`, `E7add9`, `A9` | `F7`, `E7`, `A7` | Repliés sur la famille de dominante. |
| `F#dim`, `Em7b5` | inchangés | Leur quinte est diminuée : la remplacer par une quinte juste s'entend. Les accords diminués de passage sont une signature du choro. |

Un chiffrage que la règle ne reconnaît pas est affiché tel quel — mieux vaut un
accord inhabituel qu'un accord faux. Écrivez `Xdim` sans espace : `C dim` est
toléré et normalisé, mais l'écriture collée est la référence.

Deux accords voisins d'une même mesure qui se simplifient en un seul (`Cm/Eb`
puis `Cm/G`) fusionnent : la mesure cesse d'être partagée.

La règle vit dans `simplifyChord()` / `simplifyGrille()`, dans
`web/src/grille.ts`.
