/** Persistance de la progression dans le `localStorage`.
 *
 * Tout est lu de façon défensive : un stockage absent, désactivé (navigation
 * privée) ou corrompu redonne un état vide plutôt que de casser la page.
 */

import type {
  DisplayMode,
  EclipseIntensity,
  InstrumentId,
  MaskLevel,
  SessionRun,
  Setlist,
  Song,
  SrsCard,
  StudyMode,
  TechniqueSetlist,
} from './types';
import {
  isDisplayMode,
  isEclipseIntensity,
  isInstrumentId,
  isMaskLevel,
  isSessionKind,
  isStudyMode,
} from './types';
import { ensureFsrs, review } from './srs';

const STORAGE_KEY = 'choro-srs-v1';
const DEMO_ACTIVE_KEY = 'choro-demo';
const DEMO_STORAGE_KEY = 'choro-demo-srs';

/** Mode démonstration (#109, outil de QA) : `sessionStorage` plutôt que
 *  `localStorage` — fermer l'onglet suffit à tout effacer, y compris si on
 *  oublie de cliquer « Quitter ». La progression réelle n'est jamais lue ni
 *  écrite tant que ce drapeau est actif. */
export function isDemoActive(): boolean {
  try {
    return sessionStorage.getItem(DEMO_ACTIVE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface Progress {
  /** Indexé par `${songId}::${instrumentId}`. */
  cards: Record<string, SrsCard>;
  /** Setlists de travail (préparation de concert). */
  setlists: Setlist[];
  /** Setlist active, ou `null` pour travailler tout le répertoire. */
  activeSetlistId: string | null;
  /** Setlists de technique (gammes, arpèges), indépendantes de celles du répertoire. */
  techniqueSetlists: TechniqueSetlist[];
  /** Setlist de technique active, ou `null` pour travailler tout le catalogue. */
  activeTechniqueSetlistId: string | null;
  /** Vrai une fois les setlists de technique suggérées par défaut (#158)
   *  proposées — évite de les recréer si l'utilisateur les a supprimées. */
  techniquePresetsSeeded: boolean;
  /** Historique des séances menées ; ajout seul, jamais modifié. Plafonné à 200. */
  sessions: SessionRun[];
  /**
   * Horodatage `Date.now()` du dernier enregistrement. Sert d'arbitre à la
   * fusion entre appareils pour les blocs non fusionnables carte par carte
   * (réglages, setlists).
   */
  _rev: number;
  /** Préférences d'interface, mémorisées d'une session à l'autre. */
  settings: {
    blockMinutes: number;
    /** Zone d'étude affichée : partition en portée ou grille d'accords. */
    display: DisplayMode;
    /** Comment la partition est présentée : voir `StudyMode`. */
    studyMode: StudyMode;
    /** Taux de masquage, utilisé par le seul mode « Mesures cachées ». */
    maskLevel: MaskLevel;
    /**
     * Graine du tirage des mesures masquées. Elle est persistée pour que le
     * motif soit identique d'un chargement à l'autre — on révise les mêmes
     * trous — et n'avance que sur un appui volontaire sur « Mélanger ».
     */
    maskSeed: number;
    /** Réglage du seul mode « Éclipses ». */
    eclipseIntensity: EclipseIntensity;
    /** Tonalité par défaut, utilisée pour préremplir les écrans qui doivent
     *  choisir un instrument avant tout historique par morceau (filage,
     *  premier passage sur un morceau). Ne force jamais un choix déjà fait
     *  morceau par morceau. */
    instrumentDefault: InstrumentId;
    /** Préférence avec/sans contre-chant. Sans effet tant qu'aucun morceau ne
     *  propose de variante contraponto (#80) — champ posé à l'avance pour que
     *  l'assistant d'accueil et la page Compte puissent déjà l'enregistrer. */
    contrechant: 'avec' | 'sans';
    /** Position du panneau de réglages, déplacé à la main. */
    panel: { x: number; y: number } | null;
    /** Préférences du mode plein écran de la partition. */
    fullpage: {
      /** Facteur d'agrandissement des pages, de 0,4 à 3. */
      zoom: number;
      /** Deux pages côte à côte (sur écran large uniquement). */
      twoColumns: boolean;
      /** Barre de transport masquée au profit d'un lecteur minimal. */
      playerHidden: boolean;
    };
  };
}

export const DEFAULT_FULLPAGE = {
  zoom: 1,
  twoColumns: true,
  playerHidden: false,
};

const DEFAULT_PROGRESS: Progress = {
  cards: {},
  setlists: [],
  activeSetlistId: null,
  techniqueSetlists: [],
  activeTechniqueSetlistId: null,
  techniquePresetsSeeded: false,
  sessions: [],
  _rev: 0,
  settings: {
    blockMinutes: 5,
    display: 'partition',
    studyMode: 'mesures',
    maskLevel: 50,
    maskSeed: 1,
    eclipseIntensity: 'moyennes',
    instrumentDefault: 'c',
    contrechant: 'sans',
    panel: null,
    fullpage: { ...DEFAULT_FULLPAGE },
  },
};

/** Appelé après chaque enregistrement réussi — branché par le module de synchro. */
let afterSave: (progress: Progress) => void = () => {};

export function setAfterSave(hook: (progress: Progress) => void): void {
  afterSave = hook;
}

export function cardKey(songId: string, instrumentId: InstrumentId): string {
  return `${songId}::${instrumentId}`;
}

function isCard(value: unknown): value is SrsCard {
  if (typeof value !== 'object' || value === null) return false;
  const card = value as Partial<SrsCard>;
  return (
    typeof card.ease === 'number' &&
    typeof card.interval === 'number' &&
    typeof card.repetitions === 'number' &&
    typeof card.due === 'string'
  );
}

/** Normalise une entrée de setlist lue du stockage, ou `null` si inexploitable. */
function sanitizeSetlist(value: unknown): Setlist | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.name !== 'string') return null;
  const songIds = Array.isArray(raw.songIds)
    ? raw.songIds.filter((id): id is string => typeof id === 'string')
    : [];
  const createdAt =
    typeof raw.createdAt === 'string' && raw.createdAt !== ''
      ? raw.createdAt
      : new Date().toISOString();
  return { id: raw.id, name: raw.name, songIds, createdAt };
}

/** Normalise une entrée de setlist technique lue du stockage, ou `null` si inexploitable. */
function sanitizeTechniqueSetlist(value: unknown): TechniqueSetlist | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.name !== 'string') return null;
  const exerciceIds = Array.isArray(raw.exerciceIds)
    ? raw.exerciceIds.filter((id): id is string => typeof id === 'string')
    : [];
  const createdAt =
    typeof raw.createdAt === 'string' && raw.createdAt !== ''
      ? raw.createdAt
      : new Date().toISOString();
  return { id: raw.id, name: raw.name, exerciceIds, createdAt };
}

/** Normalise une séance lue du stockage, ou `null` si inexploitable. */
function sanitizeSessionRun(value: unknown): SessionRun | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.date !== 'string' || raw.date === '') return null;
  // Le repli doit rester le dernier recours : tout genre connu passe par le
  // garde, faute de quoi une séance serait relue sous une autre étiquette.
  const kind = isSessionKind(raw.kind) ? raw.kind : 'urgent';
  return {
    date: raw.date,
    kind,
    instrumentId: isInstrumentId(raw.instrumentId) ? raw.instrumentId : null,
    setlistId: typeof raw.setlistId === 'string' ? raw.setlistId : null,
    setlistName:
      typeof raw.setlistName === 'string' && raw.setlistName !== ''
        ? raw.setlistName
        : 'Tout le répertoire',
    songCount:
      typeof raw.songCount === 'number' && Number.isFinite(raw.songCount)
        ? Math.max(0, Math.round(raw.songCount))
        : 0,
  };
}

export function loadProgress(): Progress {
  let raw: string | null = null;
  try {
    raw = isDemoActive()
      ? sessionStorage.getItem(DEMO_STORAGE_KEY)
      : localStorage.getItem(STORAGE_KEY);
  } catch {
    return structuredClone(DEFAULT_PROGRESS);
  }
  if (!raw) return structuredClone(DEFAULT_PROGRESS);

  try {
    const parsed = JSON.parse(raw) as Partial<Progress>;
    const cards: Record<string, SrsCard> = {};
    for (const [key, value] of Object.entries(parsed.cards ?? {})) {
      if (isCard(value)) {
        const withHistory = { ...value, history: Array.isArray(value.history) ? value.history : [] };
        // Migre une carte SM-2 héritée, ou reconstruit un état FSRS perdu à
        // la synchro (voir `normalizeCard` dans `sync.ts`) — sans effet sur
        // une carte déjà migrée.
        cards[key] = ensureFsrs(withHistory);
      }
    }
    const stored = (parsed.settings ?? {}) as Record<string, unknown>;
    const settings = { ...DEFAULT_PROGRESS.settings, ...stored };
    // La migration doit consulter les réglages **bruts** : après fusion avec
    // les valeurs par défaut, `studyMode` est toujours renseigné, et l'on ne
    // saurait plus distinguer un réglage ancien d'un réglage courant.
    migrateSettings(settings, stored);

    const setlists = Array.isArray(parsed.setlists)
      ? parsed.setlists
          .map(sanitizeSetlist)
          .filter((entry): entry is Setlist => entry !== null)
      : [];
    const activeSetlistId =
      typeof parsed.activeSetlistId === 'string' &&
      setlists.some((entry) => entry.id === parsed.activeSetlistId)
        ? parsed.activeSetlistId
        : null;
    const techniqueSetlists = Array.isArray(parsed.techniqueSetlists)
      ? parsed.techniqueSetlists
          .map(sanitizeTechniqueSetlist)
          .filter((entry): entry is TechniqueSetlist => entry !== null)
      : [];
    const activeTechniqueSetlistId =
      typeof parsed.activeTechniqueSetlistId === 'string' &&
      techniqueSetlists.some((entry) => entry.id === parsed.activeTechniqueSetlistId)
        ? parsed.activeTechniqueSetlistId
        : null;
    const techniquePresetsSeeded = parsed.techniquePresetsSeeded === true;
    const rev =
      typeof parsed._rev === 'number' && Number.isFinite(parsed._rev)
        ? parsed._rev
        : 0;

    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions
          .map(sanitizeSessionRun)
          .filter((entry): entry is SessionRun => entry !== null)
          .slice(-200)
      : [];

    return {
      cards,
      setlists,
      activeSetlistId,
      techniqueSetlists,
      activeTechniqueSetlistId,
      techniquePresetsSeeded,
      sessions,
      _rev: rev,
      settings,
    };
  } catch {
    return structuredClone(DEFAULT_PROGRESS);
  }
}

/**
 * Ramène des réglages enregistrés par une version antérieure dans le modèle
 * courant, et neutralise toute valeur que l'interface ne saurait plus afficher.
 */
function migrateSettings(
  settings: Progress['settings'],
  stored: Record<string, unknown>,
): void {
  if (!isDisplayMode(settings.display)) {
    settings.display = DEFAULT_PROGRESS.settings.display;
  }
  if (!isStudyMode(stored.studyMode)) {
    // Le masquage était naguère un simple taux, dont deux valeurs décrivaient
    // en réalité des modes.
    const legacy = stored.maskLevel;
    settings.studyMode =
      legacy === 0 ? 'entiere' : legacy === 'aucune' ? 'sans' : 'mesures';
  }
  if (!isMaskLevel(settings.maskLevel)) {
    // Le palier 80 % des toutes premières versions retombe sur le plus proche.
    settings.maskLevel = settings.maskLevel === (80 as unknown as MaskLevel)
      ? 75
      : DEFAULT_PROGRESS.settings.maskLevel;
  }
  if (!isEclipseIntensity(settings.eclipseIntensity)) {
    settings.eclipseIntensity = DEFAULT_PROGRESS.settings.eclipseIntensity;
  }
  if (!isInstrumentId(settings.instrumentDefault)) {
    settings.instrumentDefault = DEFAULT_PROGRESS.settings.instrumentDefault;
  }
  if (settings.contrechant !== 'avec' && settings.contrechant !== 'sans') {
    settings.contrechant = DEFAULT_PROGRESS.settings.contrechant;
  }
  if (typeof settings.maskSeed !== 'number' || !Number.isFinite(settings.maskSeed)) {
    settings.maskSeed = DEFAULT_PROGRESS.settings.maskSeed;
  }
  const panel = settings.panel as { x?: unknown; y?: unknown } | null;
  if (
    !panel ||
    typeof panel.x !== 'number' ||
    typeof panel.y !== 'number' ||
    !Number.isFinite(panel.x) ||
    !Number.isFinite(panel.y)
  ) {
    settings.panel = null;
  }

  const fp = settings.fullpage as Partial<Progress['settings']['fullpage']> | undefined;
  const zoom = Number(fp?.zoom);
  settings.fullpage = {
    zoom: Number.isFinite(zoom) && zoom >= 0.4 && zoom <= 3 ? zoom : DEFAULT_FULLPAGE.zoom,
    twoColumns:
      typeof fp?.twoColumns === 'boolean' ? fp.twoColumns : DEFAULT_FULLPAGE.twoColumns,
    playerHidden:
      typeof fp?.playerHidden === 'boolean' ? fp.playerHidden : DEFAULT_FULLPAGE.playerHidden,
  };
}

export function saveProgress(progress: Progress): void {
  progress._rev = Date.now();
  const demo = isDemoActive();
  try {
    if (demo) sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(progress));
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Quota plein ou stockage refusé : la session reste utilisable en mémoire.
    console.warn('Progression non enregistrée (localStorage indisponible).');
  }
  // La démo ne doit jamais déclencher de synchro : elle pousserait des
  // données de test vers le stockage réel du compte (#109, mode démo).
  if (!demo) afterSave(progress);
}

/**
 * Écrit sans toucher à `_rev` ni notifier la synchro. Réservé au module de
 * synchro lui-même, quand il enregistre le résultat d'une fusion : il ne faut
 * pas qu'un `pull` déclenche aussitôt un `push`. Jamais atteint en mode démo
 * (la synchro y est coupée dans `saveProgress`), mais routé par cohérence.
 */
export function persistMerged(progress: Progress): void {
  try {
    if (isDemoActive()) sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(progress));
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    console.warn('Progression non enregistrée (localStorage indisponible).');
  }
}

/**
 * Amorce un parcours de démonstration (#109, outil de QA) : un morceau par
 * branche de `recommendedMode`, construit via `review()` comme une vraie
 * séance l'aurait fait. Active le drapeau **avant** d'écrire, pour que les
 * `putCard`/`saveProgress` qui suivent routent déjà vers `DEMO_STORAGE_KEY`
 * et ne touchent jamais la progression réelle.
 */
export function seedDemoProgress(songs: Song[]): void {
  sessionStorage.setItem(DEMO_ACTIVE_KEY, '1');
  const progress = structuredClone(DEFAULT_PROGRESS);
  const scenarios: number[][] = [
    [], // nouveau morceau -> 'entiere'
    [5], // un seul Good/Easy -> 'entiere'
    [5, 5], // deux Good/Easy, nombre pair -> 'sans' (Consigne)
    [5, 5, 5], // trois Good/Easy, nombre impair -> 'entiere' (alternance)
    [5, 5, 1], // Again récent malgré l'historique -> 'entiere'
  ];
  scenarios.forEach((grades, i) => {
    const song = songs[i];
    if (!song || grades.length === 0) return;
    const instrumentId = song.instruments[0]!.id;
    let card: SrsCard | undefined;
    for (const grade of grades) card = review(card, grade, 'fluide', 0);
    putCard(progress, song.id, instrumentId, card!);
  });
}

/** Quitte le mode démonstration : efface le drapeau et les données de test. */
export function stopDemo(): void {
  sessionStorage.removeItem(DEMO_ACTIVE_KEY);
  sessionStorage.removeItem(DEMO_STORAGE_KEY);
}

/** Setlist active, ou `null`. */
export function activeSetlist(progress: Progress): Setlist | null {
  if (!progress.activeSetlistId) return null;
  return (
    progress.setlists.find((entry) => entry.id === progress.activeSetlistId) ??
    null
  );
}

/** Crée ou remplace une setlist (identité par `id`), puis enregistre. */
export function upsertSetlist(progress: Progress, setlist: Setlist): void {
  const index = progress.setlists.findIndex((entry) => entry.id === setlist.id);
  if (index === -1) progress.setlists.push(setlist);
  else progress.setlists[index] = setlist;
  saveProgress(progress);
}

/** Supprime une setlist ; si c'était l'active, on repasse sur tout le répertoire. */
export function deleteSetlist(progress: Progress, id: string): void {
  progress.setlists = progress.setlists.filter((entry) => entry.id !== id);
  if (progress.activeSetlistId === id) progress.activeSetlistId = null;
  saveProgress(progress);
}

export function setActiveSetlist(progress: Progress, id: string | null): void {
  progress.activeSetlistId =
    id && progress.setlists.some((entry) => entry.id === id) ? id : null;
  saveProgress(progress);
}

/** Setlist de technique active, ou `null`. */
export function activeTechniqueSetlist(progress: Progress): TechniqueSetlist | null {
  if (!progress.activeTechniqueSetlistId) return null;
  return (
    progress.techniqueSetlists.find(
      (entry) => entry.id === progress.activeTechniqueSetlistId,
    ) ?? null
  );
}

/** Crée ou remplace une setlist de technique (identité par `id`), puis enregistre. */
export function upsertTechniqueSetlist(
  progress: Progress,
  setlist: TechniqueSetlist,
): void {
  const index = progress.techniqueSetlists.findIndex((entry) => entry.id === setlist.id);
  if (index === -1) progress.techniqueSetlists.push(setlist);
  else progress.techniqueSetlists[index] = setlist;
  saveProgress(progress);
}

/** Supprime une setlist de technique ; si c'était l'active, on repasse sur tout le catalogue. */
export function deleteTechniqueSetlist(progress: Progress, id: string): void {
  progress.techniqueSetlists = progress.techniqueSetlists.filter((entry) => entry.id !== id);
  if (progress.activeTechniqueSetlistId === id) progress.activeTechniqueSetlistId = null;
  saveProgress(progress);
}

export function setActiveTechniqueSetlist(progress: Progress, id: string | null): void {
  progress.activeTechniqueSetlistId =
    id && progress.techniqueSetlists.some((entry) => entry.id === id) ? id : null;
  saveProgress(progress);
}

/** Ajoute une séance à l'historique (plafonné à 200), puis enregistre. */
export function recordSession(progress: Progress, run: SessionRun): void {
  progress.sessions.push(run);
  if (progress.sessions.length > 200) {
    progress.sessions = progress.sessions.slice(-200);
  }
  saveProgress(progress);
}

/** La séance la plus récente, ou `undefined`. */
export function lastSession(progress: Progress): SessionRun | undefined {
  return progress.sessions[progress.sessions.length - 1];
}

export function getCard(
  progress: Progress,
  songId: string,
  instrumentId: InstrumentId,
): SrsCard | undefined {
  return progress.cards[cardKey(songId, instrumentId)];
}

export function putCard(
  progress: Progress,
  songId: string,
  instrumentId: InstrumentId,
  card: SrsCard,
): void {
  progress.cards[cardKey(songId, instrumentId)] = card;
  saveProgress(progress);
}

/**
 * Clé des cartes d'arpèges et de gammes.
 *
 * Elles vivent dans le **même** `progress.cards` que les morceaux : la fusion
 * de la synchro itère sur les clés sans regarder ce qu'elles désignent, si
 * bien qu'elles sont synchronisées sans code supplémentaire. Le préfixe les
 * tient à l'écart des clés `${songId}::${instrumentId}`, dont la forme reste
 * inchangée — la modifier invaliderait les cartes déjà enregistrées.
 */
export function techniqueCardKey(exerciceId: string): string {
  return `tech::${exerciceId}`;
}

export function getTechniqueCard(
  progress: Progress,
  exerciceId: string,
): SrsCard | undefined {
  return progress.cards[techniqueCardKey(exerciceId)];
}

export function putTechniqueCard(
  progress: Progress,
  exerciceId: string,
  card: SrsCard,
): void {
  progress.cards[techniqueCardKey(exerciceId)] = card;
  saveProgress(progress);
}
