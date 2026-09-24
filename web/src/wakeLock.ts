/**
 * Écran toujours allumé pendant qu'on joue (#170).
 *
 * L'app s'utilise instrument en main, téléphone posé sur un pupitre : sans
 * verrou, l'écran se met en veille au bout de 30 s et il faut poser
 * l'instrument pour le rallumer. `holdScreenAwake()` demande un
 * `WakeLockSentinel` pour la durée d'une vue de jeu (entraînement, filage,
 * technique) et renvoie la fonction qui le relâche.
 *
 * Le navigateur relâche lui-même le verrou quand l'onglet passe en arrière-plan :
 * on le redemande au retour au premier plan (`visibilitychange`). Après une
 * pause prolongée sans aucune interaction, on le relâche pour laisser l'écran
 * s'éteindre normalement ; le moindre geste le reprend. Dégradation silencieuse
 * si l'API manque ou refuse (batterie faible, contexte non sécurisé…).
 */

/** Sans geste pendant ce délai, on considère le pupitre abandonné. */
export const IDLE_RELEASE_MS = 15 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown'] as const;

export function holdScreenAwake(idleMs = IDLE_RELEASE_MS): () => void {
  const wakeLock = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
  if (!wakeLock) return () => {};

  let sentinel: WakeLockSentinel | null = null;
  let pending = false;
  let idle = false;
  let disposed = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const acquire = (): void => {
    if (disposed || idle || sentinel || pending || document.visibilityState !== 'visible') return;
    pending = true;
    wakeLock
      .request('screen')
      .then((lock) => {
        pending = false;
        if (disposed || idle) {
          void lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
        });
      })
      .catch(() => {
        pending = false;
      });
  };

  const release = (): void => {
    const lock = sentinel;
    sentinel = null;
    if (lock && !lock.released) void lock.release().catch(() => {});
  };

  const armIdle = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idle = true;
      release();
    }, idleMs);
  };

  const onActivity = (): void => {
    idle = false;
    armIdle();
    acquire();
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') acquire();
  };

  document.addEventListener('visibilitychange', onVisibility);
  for (const type of ACTIVITY_EVENTS) document.addEventListener(type, onActivity, true);
  armIdle();
  acquire();

  return () => {
    disposed = true;
    clearTimeout(idleTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    for (const type of ACTIVITY_EVENTS) document.removeEventListener(type, onActivity, true);
    release();
  };
}
