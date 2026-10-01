/** Fiches de conseils de travail : du texte à lire, pas des cartes à réviser.
 *
 * Ce que le cours dit du **phrasé** ne se réduit pas à une suite de notes
 * qu'un micro peut noter : choisir où placer une note, entendre une couleur,
 * alterner deux versions d'une phrase. Ces conseils vivent donc ici, à part
 * de la répétition espacée. Une fiche se rattache à une famille du catalogue
 * (le lien apparaît sous son titre dans la liste Technique), et un exercice
 * peut renvoyer aux motifs qui le travaillent note à note.
 */

export interface TableauConseil {
  entetes: string[];
  lignes: string[][];
}

export interface SectionConseil {
  titre: string;
  paragraphes?: string[];
  points?: string[];
  tableau?: TableauConseil;
}

export interface ExerciceConseil {
  titre: string;
  consigne: string;
  /** Phrases à jouer, écrites en noms de notes ; « | » marque l'arrivée. */
  phrases?: string[];
  suite?: string;
  /** Motifs du catalogue qui travaillent cet exercice au métronome. */
  motifs?: string[];
}

export interface FicheConseils {
  id: string;
  /** Famille du catalogue sous laquelle la fiche est proposée. */
  famille: string;
  titre: string;
  resume: string;
  sections: SectionConseil[];
  exercices: ExerciceConseil[];
  ecoute?: string;
}

export const FICHES_CONSEILS: FicheConseils[] = [
  {
    id: 'dominante-vers-mineur',
    famille: 'Dominantes',
    titre: 'Dominante vers le mineur\u00a0: faire entendre l’arrivée',
    resume:
      'Le même accord de 7e, une autre gamme : quand le V7 va vers un mineur, ' +
      'sa 9 et sa 13 baissent d’un demi-ton. Conseils de phrasé tirés du cours, ' +
      'en la mineur (Mi7 → La m) comme dans les leçons.',
    sections: [
      {
        titre: 'La règle',
        paragraphes: [
          'Vers un accord majeur, la dominante prend le mixolydien. Vers un accord ' +
            'mineur, le mixolydien ♭9 ♭13. L’accord, lui, ne change pas : Mi7 reste ' +
            'Mi – Sol♯ – Si – Ré. C’est sa destination qui choisit la gamme — le ' +
            'standard du choro et de la samba.',
        ],
        tableau: {
          entetes: ['Mi7 vers', '1', '9', '3', '4', '5', '13', '♭7'],
          lignes: [
            ['La', 'Mi', 'Fa♯', 'Sol♯', 'La', 'Si', 'Do♯', 'Ré'],
            ['La m', 'Mi', 'Fa', 'Sol♯', 'La', 'Si', 'Do', 'Ré'],
          ],
        },
      },
      {
        titre: 'Pourquoi l’oreille entend le mineur avant qu’il n’arrive',
        paragraphes: [
          'Les sept notes de Mi7 ♭9 ♭13 sont exactement celles de la mineur ' +
            'harmonique, jouées depuis le mi. Le do est déjà la tierce mineure de ' +
            'l’accord d’arrivée ; le fa, sa sixte mineure, glisse d’un demi-ton sur ' +
            'le mi. La couleur est reconnaissable entre toutes — « un air un peu arabe ».',
        ],
      },
      {
        titre: 'Conseils',
        points: [
          'L’arpège 7(♭9) est l’outil n° 1. Sans sa fondamentale, Sol♯ – Si – Ré – Fa ' +
            'est un arpège diminué : tes arpèges diminués servent sur toute ' +
            'dominante qui va vers un mineur.',
          'Une formule à garder : 3ce → 5te → ♭9 → fondamentale, puis la résolution ' +
            '(Sol♯ – Si – Fa – Mi → La m). Dès le sol dièse, on entend qu’on revient ' +
            'en la mineur.',
          'Partir de la 7e, sur le temps, et descendre la gamme ♭9 ♭13 jusqu’à ' +
            'l’accord mineur. Au 7 cordes, les gammes descendantes sont bien plus ' +
            'fréquentes que les montantes.',
          'Placer les notes importantes sur les temps : 3ce, 7e et ♭9 sur la ' +
            'dominante ; fondamentale ou tierce mineure à l’arrivée.',
          'Chanter avant de jouer : la tête doit venir avant la main.',
          'Retenir le son de la phrase, pas la mécanique des doigts.',
        ],
      },
    ],
    exercices: [
      {
        titre: 'Majeur contre mineur',
        consigne:
          'Joue la phrase sur Mi7 et résous sur La. Rejoue-la avec fa naturel et ' +
          'résous sur La m. Alterne les deux jusqu’à entendre la différence sans ' +
          'regarder le manche.',
        phrases: [
          'Mi7 → La : Sol♯ Ré Fa♯ Mi Ré Si Sol♯ | La',
          'Mi7 → La m : Sol♯ Ré Fa Mi Ré Si Sol♯ | La',
        ],
      },
      {
        titre: 'La gamme ♭9 ♭13 en descente vers la cible',
        consigne:
          'Une mesure de Mi7, puis La m : la descente arrive sur le do, tierce ' +
          'mineure, au premier temps.',
        phrases: ['Ré Do Si La · Sol♯ Fa Mi Ré | Do'],
        suite:
          'Repars ensuite de chaque note de l’accord (Mi, Sol♯, Si, Ré), en ' +
          'atterrissant toujours sur La ou Do au premier temps.',
        motifs: ['dom-mixo-min'],
      },
      {
        titre: 'L’arpège diminué comme dominante',
        consigne: 'L’arpège 3‑5‑7‑♭9 de Mi7, en montant puis en descendant, résolu sur La m.',
        phrases: ['Sol♯ Si Ré Fa | Mi', 'Fa Ré Si Sol♯ | La'],
        suite:
          'Puis sans la fondamentale, comme dans les relevés : 7e, ♭9, 3ce, ♭9. ' +
          'Cherche aussi le dessin « sauter une note, jouer celle juste en dessous ».',
        motifs: ['dom-arp-b9', 'dom-b9-min'],
      },
      {
        titre: 'Le ii–V–i mineur complet',
        consigne:
          'Bø | Mi7 | La m | La m. La 7e du ii (La) passe à la tierce du V (Sol♯), ' +
          'puis la gamme ♭9 ♭13 sur le V jusqu’à la résolution.',
        suite:
          'Prépare deux ou trois phrases et change de phrase à chaque tour de la ' +
          'même grille — au hasard, pas dans l’ordre.',
        motifs: ['dom-251-min'],
      },
      {
        titre: 'Transposer sur les résolutions typiques du choro',
        consigne:
          'Pour chaque tonalité, nomme d’abord les deux notes à baisser (la 9 et ' +
          'la 13), chante, puis rejoue les exercices 2 et 3. Analyser, chanter, ' +
          'jouer, transposer.',
        phrases: ['La7 → Ré m · Ré7 → Sol m · Mi7 → La m · Si7 → Mi m · Sol7 → Do m · Do7 → Fa m'],
        motifs: ['dom-gamme-mixo-b9b13'],
      },
    ],
    ecoute:
      'Dans les relevés, quand une dominante arrive, devine si elle va vers le ' +
      'majeur ou le mineur rien qu’à sa 9 et à sa 13.',
  },
];

export function ficheConseils(id: string): FicheConseils | undefined {
  return FICHES_CONSEILS.find((fiche) => fiche.id === id);
}

export function fichesDeLaFamille(famille: string): FicheConseils[] {
  return FICHES_CONSEILS.filter((fiche) => fiche.famille === famille);
}
