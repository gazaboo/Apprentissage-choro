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
