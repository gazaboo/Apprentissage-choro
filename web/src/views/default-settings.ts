/** Champs de réglages par défaut, partagés entre l'assistant d'accueil
 *  (`onboarding.ts`) et la section « Réglages par défaut » de la page Compte
 *  (`account.ts`) — mêmes questions, deux points d'entrée.
 */

import { el, segmented, ui } from '../dom';
import type { DisplayMode, InstrumentId, Song } from '../types';
import { INSTRUMENT_KEY_LABELS } from '../types';

export interface DefaultSettingsValues {
  instrumentDefault: InstrumentId;
  display: DisplayMode;
  contrechant: 'avec' | 'sans';
}

/** Vrai dès qu'un morceau propose une variante avec/sans contre-chant.
 *  L'option correspondante reste absente du contrôle tant qu'aucun morceau
 *  n'a de contraponto, plutôt que proposée sans effet. */
export function hasContrechantData(songs: Song[]): boolean {
  return songs.some((song) => song.contraponto !== null);
}

type AffichageChoice = 'partition' | 'partition-contrechant' | 'grille';

function affichageOptions(hasContrechant: boolean): { value: AffichageChoice; label: string }[] {
  return hasContrechant
    ? [
        { value: 'partition', label: 'Partition — mélodie seule' },
        { value: 'partition-contrechant', label: 'Partition — mélodie et contre-chant' },
        { value: 'grille', label: 'Grille d’accords' },
      ]
    : [
        { value: 'partition', label: 'Partition' },
        { value: 'grille', label: 'Grille d’accords' },
      ];
}

function toAffichageChoice(display: DisplayMode, contrechant: 'avec' | 'sans'): AffichageChoice {
  if (display === 'grille') return 'grille';
  return contrechant === 'avec' ? 'partition-contrechant' : 'partition';
}

function fromAffichageChoice(
  choice: AffichageChoice,
): { display: DisplayMode; contrechant: 'avec' | 'sans' } {
  if (choice === 'grille') return { display: 'grille', contrechant: 'sans' };
  return { display: 'partition', contrechant: choice === 'partition-contrechant' ? 'avec' : 'sans' };
}

/** Construit les deux champs (Tonalité, Affichage préféré). Rappelle
 *  `onChange` avec les valeurs complètes à chaque choix. */
export function renderDefaultSettingsFields(
  songs: Song[],
  initial: DefaultSettingsValues,
  onChange: (next: DefaultSettingsValues) => void,
): HTMLElement {
  let values = initial;

  const tonaliteGroup = segmented<InstrumentId>(
    (['c', 'bb', 'eb'] as InstrumentId[]).map((id) => ({
      value: id,
      label: INSTRUMENT_KEY_LABELS[id],
    })),
    values.instrumentDefault,
    (instrumentDefault) => {
      values = { ...values, instrumentDefault };
      onChange(values);
    },
  );

  const hasContrechant = hasContrechantData(songs);
  const affichageGroup = segmented<AffichageChoice>(
    affichageOptions(hasContrechant),
    toAffichageChoice(values.display, values.contrechant),
    (choice) => {
      values = { ...values, ...fromAffichageChoice(choice) };
      onChange(values);
    },
  );

  return el(
    'div',
    { class: 'flex flex-col gap-6' },
    el(
      'div',
      { class: 'flex flex-col gap-2' },
      el('p', { class: ui.label }, 'Tonalité'),
      tonaliteGroup,
    ),
    el(
      'div',
      { class: 'flex flex-col gap-2' },
      el('p', { class: ui.label }, 'Affichage préféré'),
      affichageGroup,
    ),
  );
}
