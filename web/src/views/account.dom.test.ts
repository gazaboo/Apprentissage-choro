import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAccount, type AccountContext } from './account';
import { accountMode, getSyncCode } from '../sync';

function mount(overrides: Partial<AccountContext> = {}) {
  const root = document.createElement('div');
  const context: AccountContext = {
    gate: false,
    onChange: vi.fn(),
    navigateHome: vi.fn(),
    ...overrides,
  };
  const teardown = renderAccount(root, context);
  return { root, context, teardown };
}

function findButton(root: HTMLElement, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!button) throw new Error(`bouton "${text}" introuvable`);
  return button;
}

afterEach(() => {
  vi.unstubAllGlobals();
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
  it('mode local : propose le formulaire de synchro et un retour', () => {
    const { root, context } = mount({ gate: false, navigateHome: vi.fn() });
    expect(root.textContent).toContain('Vous travaillez sur cet appareil uniquement.');
    findButton(root, 'Retour au répertoire').click();
    expect(context.navigateHome).toHaveBeenCalledOnce();
  });

  it('mode sync : propose la déconnexion, qui repasse le compte à "none"', () => {
    localStorage.setItem('choro-sync-code', 'deja-connecte');
    const { root, context } = mount({ gate: false });
    expect(accountMode()).toBe('sync');
    expect(root.textContent).toContain('deja-connecte');
    findButton(root, 'Se déconnecter').click();
    expect(context.onChange).toHaveBeenCalledOnce();
    expect(accountMode()).toBe('none');
  });
});
