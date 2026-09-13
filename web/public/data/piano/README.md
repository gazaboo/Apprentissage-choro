# Échantillons de piano — lecture des arpèges et gammes

17 notes de piano acoustique (une toutes les tierces mineures, de `C2` à
`C6`), utilisées par `web/src/technique/piano.ts` pour le bouton « Écouter »
de l'écran Technique. Les notes intermédiaires sont obtenues par
`playbackRate` (transposition ±1,5 demi-ton maximum, imperceptible sur un
piano) plutôt que d'embarquer les 88 touches.

Nommage : `<Note><Octave>.mp3`, dièse = suffixe `s` (`Cs3.mp3` = do dièse 3).
Octave à la convention scientifique : do central = `C4` = MIDI 60, comme dans
`web/src/technique/theorie.ts`.

## Origine et licence

Échantillons repris de [`nbrosowsky/tonejs-instruments`](https://github.com/nbrosowsky/tonejs-instruments)
(`samples/piano/`), eux-mêmes issus de **VSCO2 Community Edition**
(Versilian Studios Chamber Orchestra 2, édition communautaire).

Licence des échantillons : **CC BY 3.0**
(<https://creativecommons.org/licenses/by/3.0/>). Le code de ce dépôt (MIT)
n'est pas concerné, seuls les fichiers audio de ce dossier le sont.
