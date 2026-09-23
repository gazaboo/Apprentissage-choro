/**
 * Capture de l'invite d'installation PWA (`beforeinstallprompt`).
 *
 * Le navigateur peut déclencher cet événement à tout moment après le
 * chargement — souvent avant que l'utilisateur n'atteigne `#/compte` — donc
 * on le garde de côté dès le démarrage (`initPwaInstallCapture`, appelé une
 * fois depuis `main.ts`) plutôt que d'écouter depuis la vue elle-même.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

export function initPwaInstallCapture(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });
}

/** `null` tant que Chrome n'a pas jugé l'app installable, ou une fois l'invite utilisée. */
export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function clearInstallPrompt(): void {
  deferredPrompt = null;
}

/** Vrai si l'app tourne déjà en fenêtre autonome (installée, sans barre d'adresse). */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}
