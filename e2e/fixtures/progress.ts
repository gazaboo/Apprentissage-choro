import type { Page } from '@playwright/test';

/**
 * Reflète `Progress` de `web/src/store.ts` (`DEFAULT_PROGRESS`) — dupliqué
 * ici plutôt qu'importé : l'app buildée (`vite build`) et l'E2E n'ont pas le
 * même graphe de modules, et ce paquet ne dépend pas de `web/`.
 */
export interface ProgressFixture {
  cards: Record<string, unknown>;
  setlists: Array<{ id: string; name: string; songIds: string[] }>;
  activeSetlistId: string | null;
  sessions: unknown[];
  _rev: number;
  settings: {
    blockMinutes: number;
    display: 'partition' | 'grille';
    studyMode: string;
    maskLevel: number;
    maskSeed: number;
    eclipseIntensity: string;
    panel: { x: number; y: number } | null;
    fullpage: { zoom: number; twoColumns: boolean; playerHidden: boolean };
  };
}

const STORAGE_KEY = 'choro-srs-v1';
const ACCOUNT_KEY = 'choro-account';

export function defaultProgress(overrides: Partial<ProgressFixture> = {}): ProgressFixture {
  return {
    cards: {},
    setlists: [],
    activeSetlistId: null,
    sessions: [],
    _rev: 0,
    settings: {
      blockMinutes: 5,
      display: 'partition',
      studyMode: 'mesures',
      maskLevel: 50,
      maskSeed: 1,
      eclipseIntensity: 'moyennes',
      panel: null,
      fullpage: { zoom: 1, twoColumns: true, playerHidden: false },
    },
    ...overrides,
  };
}

/**
 * Pose l'état initial avant le premier chargement : progression + compte
 * local (`'local'`, pas de passerelle d'accueil à franchir). À appeler avant
 * tout `page.goto`.
 */
export async function seedProgress(
  page: Page,
  progress: ProgressFixture = defaultProgress(),
): Promise<void> {
  await page.addInitScript(
    ([key, value, accountKey]) => {
      window.localStorage.setItem(key, value);
      window.localStorage.setItem(accountKey, 'local');
    },
    [STORAGE_KEY, JSON.stringify(progress), ACCOUNT_KEY] as const,
  );
}
