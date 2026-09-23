import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAccount, type AccountContext } from './account';
import { accountMode, getSyncCode } from '../sync';
import { clearInstallPrompt, initPwaInstallCapture } from '../pwaInstall';
import type { Progress } from '../store';

initPwaInstallCapture();

/** Simule l'événement que le navigateur envoie quand il juge l'app installable. */
function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(event);
  return event;
}

function baseProgress(overrides: Partial<Progress['settings']> = {}): Progress {
  return {
    cards: {},
    setlists: [],
    activeSetlistId: null,
    techniqueSetlists: [],
    activeTechniqueSetlistId: null,
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
      fullpage: { zoom: 1, twoColumns: true, playerHidden: false },
      ...overrides,
    },
  };
}

function mount(overrides: Partial<AccountContext> = {}) {
  const root = document.createElement('div');
  const context: AccountContext = {
    gate: false,
    onChange: vi.fn(),
    navigateHome: vi.fn(),
    progress: null,
    songs: [],
    ...overrides,
  };
  const teardown = renderAccount(root, context);
  return { root, context, teardown };
}

/** Trouve par texte visible, ou par `aria-label` pour un bouton icône seule. */
function findButton(root: HTMLElement, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find(
    (b) => b.textContent === text || b.getAttribute('aria-label') === text,
  );
  if (!button) throw new Error(`bouton "${text}" introuvable`);
  return button;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearInstallPrompt();
});

describe('renderAccount — passerelle (gate: true)', () => {
  it('ne propose pas de retour', () => {
    const { root } = mount({ gate: true });
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Retour au répertoire')).toBe(false);
  });

  it('« Continuer » choisit anonyme et notifie', () => {
    const { root, context } = mount({ gate: true });
    findButton(root, 'Continuer').click();
    expect(context.onChange).toHaveBeenCalledOnce();
    expect(accountMode()).toBe('local');
  });
});

describe('renderAccount — formulaire d\'identifiant', () => {
  it('moins de 3 caractères : message d\'erreur, pas de requête réseau', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { root, context } = mount({ gate: true });
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'ab';
    findButton(root, 'Se connecter').click();
    await Promise.resolve();
    expect(root.textContent).toContain('au moins 3 caractères');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(context.onChange).not.toHaveBeenCalled();
  });

  it('caractères refusés : message d\'erreur dédié', async () => {
    const { root } = mount({ gate: true });
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'a b';
    findButton(root, 'Se connecter').click();
    await Promise.resolve();
    expect(root.textContent).toContain('Lettres, chiffres, tiret ou souligné');
  });

  it('identifiant connu (serveur répond 200) : connexion directe et onChange rappelé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
    );
    const { root, context } = mount({ gate: true });
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'mon-code';
    findButton(root, 'Se connecter').click();
    // `submit` est async (probeCode) puis `connect` déclenche `syncNow` (async aussi).
    await vi.waitFor(() => expect(context.onChange).toHaveBeenCalled());
    expect(getSyncCode()).toBe('mon-code');
  });

  it('identifiant inconnu (404) : propose de créer, sans connecter tout de suite', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
    );
    const { root, context } = mount({ gate: true });
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'nouveau-code';
    findButton(root, 'Se connecter').click();
    await vi.waitFor(() => expect(root.textContent).toContain('n’existe pas encore'));
    expect(context.onChange).not.toHaveBeenCalled();
  });
});

describe('renderAccount — page compte (gate: false)', () => {
  it('ne propose plus de connexion/déconnexion : juste un retour', () => {
    const { root, context } = mount({ gate: false, navigateHome: vi.fn() });
    expect(root.textContent).not.toContain('Vous travaillez sur cet appareil uniquement.');
    expect(root.textContent).not.toContain('Se déconnecter');
    findButton(root, 'Retour au répertoire').click();
    expect(context.navigateHome).toHaveBeenCalledOnce();
  });

  it('sans `progress` (passerelle) : pas de section réglages par défaut', () => {
    const { root } = mount({ gate: false, progress: null });
    expect(root.textContent).not.toContain('Réglages par défaut');
  });

  it('avec `progress` : la section réglages par défaut est modifiable en direct', () => {
    const progress = baseProgress();
    const { root } = mount({ gate: false, progress });
    expect(root.textContent).toContain('Réglages par défaut');
    findButton(root, 'Si♭ / B♭').click();
    expect(progress.settings.instrumentDefault).toBe('bb');
    findButton(root, 'Grille d’accords').click();
    expect(progress.settings.display).toBe('grille');
  });
});

describe('renderAccount — carte d’installation PWA', () => {
  it('aucune carte sans invite du navigateur', () => {
    const { root } = mount({ gate: false });
    expect(root.textContent).not.toContain('Installer');
  });

  it('avec l’invite captée : bouton visible, déclenche `prompt()` et disparaît ensuite', async () => {
    const event = fireBeforeInstallPrompt('accepted');
    const { root } = mount({ gate: false });
    expect(root.textContent).toContain('Installer');

    findButton(root, 'Installer').click();
    expect(event.prompt).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(root.textContent).not.toContain('Installer'));
  });

  it('masquée si l’app tourne déjà en fenêtre autonome (installée)', () => {
    fireBeforeInstallPrompt();
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    );
    const { root } = mount({ gate: false });
    expect(root.textContent).not.toContain('Installer');
  });
});
