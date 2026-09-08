/** Synchro optionnelle de la progression entre appareils, via Netlify Blobs.
 *
 * `localStorage` reste la source vive et le cache hors-ligne. Quand un « code
 * de synchro » est renseigné, chaque enregistrement programme un envoi
 * différé ; au chargement (et au retour au premier plan) on récupère l'état
 * distant et on le fusionne.
 *
 * La fusion ne perd rien : les cartes SRS sont réconciliées une par une (la
 * plus récemment révisée gagne), et les blocs non fusionnables — réglages,
 * setlists — suivent l'appareil dont l'enregistrement est le plus récent.
 */

import type { Progress } from './store';
import { loadProgress, persistMerged, setAfterSave } from './store';
import type { SrsCard, SrsReview } from './types';

const CODE_KEY = 'choro-sync-code';
const LAST_SYNC_KEY = 'choro-sync-at';
const ACCOUNT_KEY = 'choro-account';
const ENDPOINT = '/.netlify/functions/sync';
const DEBOUNCE_MS = 3000;
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

let debounceTimer: number | null = null;
let inFlight = false;
let refresh: (() => void) | null = null;

// --- Code de synchro ----------------------------------------------------

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export function getSyncCode(): string | null {
  try {
    const code = localStorage.getItem(CODE_KEY);
    return code && isValidCode(code) ? code : null;
  } catch {
    return null;
  }
}

export function setSyncCode(code: string): void {
  try {
    localStorage.setItem(CODE_KEY, code);
  } catch {
    /* stockage indisponible : rien à faire */
  }
}

export function clearSyncCode(): void {
  try {
    localStorage.removeItem(CODE_KEY);
  } catch {
    /* ignore */
  }
}

// --- Choix de « compte » à l'arrivée ----------------------------------

/**
 * `'none'`  : aucun choix fait — on affiche la passerelle d'accueil.
 * `'local'` : utilisateur anonyme, progression sur ce seul appareil.
 * `'sync'`  : un code de synchro est actif.
 */
export type AccountMode = 'none' | 'local' | 'sync';

export function accountMode(): AccountMode {
  if (getSyncCode()) return 'sync';
  try {
    return localStorage.getItem(ACCOUNT_KEY) === 'local' ? 'local' : 'none';
  } catch {
    return 'none';
  }
}

/** Choix « continuer sans compte ». */
export function chooseAnonymous(): void {
  try {
    localStorage.setItem(ACCOUNT_KEY, 'local');
  } catch {
    /* ignore */
  }
}

/** Se déconnecter du code : retour à la passerelle d'accueil. */
export function signOut(): void {
  clearSyncCode();
  try {
    localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);
  } catch {
    /* ignore */
  }
}

export function lastSyncedAt(): number | null {
  try {
    const value = Number(localStorage.getItem(LAST_SYNC_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function markSynced(): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** Délai humain depuis la dernière synchro réussie. */
export function formatLastSync(): string {
  const at = lastSyncedAt();
  if (!at) return 'jamais synchronisé';
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return 'synchronisé à l’instant';
  if (minutes < 60) return `synchronisé il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `synchronisé il y a ${hours} h`;
  return `synchronisé il y a ${Math.round(hours / 24)} j`;
}

// --- Réseau ------------------------------------------------------------

async function pull(code: string): Promise<Partial<Progress> | null> {
  try {
    const res = await fetch(`${ENDPOINT}?code=${encodeURIComponent(code)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    // 404 = identifiant connu localement mais pas (encore) de données distantes ;
    // on continue pour pousser l'état local. Les vraies erreurs → on retentera.
    if (res.status === 404) return {};
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return typeof data === 'object' && data !== null
      ? (data as Partial<Progress>)
      : {};
  } catch {
    return null;
  }
}

/**
 * Interroge le serveur sur un identifiant :
 * - `'known'`   : des données existent (on les rechargera) ;
 * - `'unknown'` : identifiant jamais utilisé (proposer de le créer) ;
 * - `'offline'` : impossible de joindre le serveur.
 */
export async function probeCode(code: string): Promise<'known' | 'unknown' | 'offline'> {
  try {
    const res = await fetch(`${ENDPOINT}?code=${encodeURIComponent(code)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (res.status === 404) return 'unknown';
    if (res.ok) return 'known';
    return 'offline';
  } catch {
    return 'offline';
  }
}

async function push(code: string, progress: Progress): Promise<boolean> {
  try {
    const res = await fetch(`${ENDPOINT}?code=${encodeURIComponent(code)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(progress),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Fusion (fonction pure) ------------------------------------------------

function normalizeCard(value: Record<string, unknown>): SrsCard {
  const history = Array.isArray(value.history)
    ? (value.history.filter(
        (entry) => typeof entry === 'object' && entry !== null,
      ) as SrsReview[])
    : [];
  return {
    ease: Number(value.ease),
    interval: Number(value.interval),
    repetitions: Number(value.repetitions),
    due: String(value.due),
    history,
  };
}

function isMergeableCard(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.ease === 'number' &&
    typeof card.interval === 'number' &&
    typeof card.repetitions === 'number' &&
    typeof card.due === 'string'
  );
}

/** Date de la dernière révision d'une carte ; `due` en repli. */
function lastTouched(card: SrsCard): string {
  const last = card.history[card.history.length - 1];
  return last?.date ?? card.due ?? '';
}

export function mergeProgress(local: Progress, remoteRaw: unknown): Progress {
  const remote: Partial<Progress> =
    typeof remoteRaw === 'object' && remoteRaw !== null
      ? (remoteRaw as Partial<Progress>)
      : {};

  // Cartes : union locale + distante, la plus récemment révisée l'emporte.
  const cards: Record<string, SrsCard> = { ...local.cards };
  const remoteCards =
    typeof remote.cards === 'object' && remote.cards !== null
      ? (remote.cards as Record<string, unknown>)
      : {};
  for (const [key, raw] of Object.entries(remoteCards)) {
    if (!isMergeableCard(raw)) continue;
    const remoteCard = normalizeCard(raw);
    const localCard = cards[key];
    if (!localCard) {
      cards[key] = remoteCard;
      continue;
    }
    const localDate = lastTouched(localCard);
    const remoteDate = lastTouched(remoteCard);
    if (
      remoteDate > localDate ||
      (remoteDate === localDate &&
        remoteCard.history.length > localCard.history.length)
    ) {
      cards[key] = remoteCard;
    }
  }

  // Séances : union pure — jamais modifiées, seulement ajoutées. Dédup par date
  // (datetime ISO, unique en pratique), tri chronologique, plafond 200.
  const seen = new Set<string>();
  const sessions = [
    ...(Array.isArray(local.sessions) ? local.sessions : []),
    ...(Array.isArray(remote.sessions) ? (remote.sessions as Progress['sessions']) : []),
  ]
    .filter((run) => {
      if (typeof run?.date !== 'string' || seen.has(run.date)) return false;
      seen.add(run.date);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-200);

  // Réglages et setlists : bloc pris de l'appareil au `_rev` le plus élevé.
  const remoteRev =
    typeof remote._rev === 'number' && Number.isFinite(remote._rev)
      ? remote._rev
      : 0;
  const takeRemoteMeta =
    remoteRev > local._rev &&
    Array.isArray(remote.setlists) &&
    typeof remote.settings === 'object' &&
    remote.settings !== null;

  const merged: Progress = {
    cards,
    setlists: takeRemoteMeta ? (remote.setlists as Progress['setlists']) : local.setlists,
    activeSetlistId: takeRemoteMeta
      ? (remote.activeSetlistId ?? null)
      : local.activeSetlistId,
    sessions,
    settings: takeRemoteMeta
      ? { ...local.settings, ...(remote.settings as Progress['settings']) }
      : local.settings,
    _rev: Math.max(local._rev, remoteRev),
  };

  // Garde-fou : l'active doit désigner une setlist réellement présente.
  if (
    merged.activeSetlistId &&
    !merged.setlists.some((entry) => entry.id === merged.activeSetlistId)
  ) {
    merged.activeSetlistId = null;
  }

  return merged;
}

// --- Cycle de synchro ---------------------------------------------------

export async function syncNow(): Promise<boolean> {
  const code = getSyncCode();
  if (!code || inFlight) return false;
  inFlight = true;
  try {
    const remote = await pull(code);
    if (remote === null) return false; // hors ligne : on retentera plus tard

    const base = loadProgress();
    const merged = mergeProgress(base, remote);
    const changed = JSON.stringify(base) !== JSON.stringify(merged);
    if (changed) persistMerged(merged);

    const ok = await push(code, merged);
    if (ok) markSynced();
    if (changed && ok) refresh?.();
    return ok;
  } finally {
    inFlight = false;
  }
}

export function scheduleSync(): void {
  if (!getSyncCode()) return;
  if (debounceTimer !== null) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    void syncNow();
  }, DEBOUNCE_MS);
}

/**
 * Branche la synchro : `onRefresh` est rappelé quand un `pull` a effectivement
 * modifié l'état local (l'appelant recharge et redessine).
 */
export function initSync(onRefresh: () => void): void {
  refresh = onRefresh;
  setAfterSave(scheduleSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync();
  });
}
