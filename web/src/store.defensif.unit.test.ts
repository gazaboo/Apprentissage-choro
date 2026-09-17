import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProgress } from './store';

/** `localStorage` minimal en mémoire — suffisant pour `loadProgress`, qui ne
 * lit qu'`getItem`. Évite de basculer ce fichier en environnement jsdom pour
 * un unique accès de lecture. */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadProgress — chemins défensifs', () => {
  it('stockage vide → progression par défaut', () => {
    const progress = loadProgress();
    expect(progress.cards).toEqual({});
    expect(progress.setlists).toEqual([]);
    expect(progress.sessions).toEqual([]);
    expect(progress._rev).toBe(0);
    expect(progress.settings.display).toBe('partition');
    expect(progress.settings.instrumentDefault).toBe('c');
    expect(progress.settings.contrechant).toBe('sans');
  });

  it('JSON invalide → progression par défaut, sans lever', () => {
    storage.setItem('choro-srs-v1', '{ pas du json valide');
    expect(() => loadProgress()).not.toThrow();
    expect(loadProgress().cards).toEqual({});
  });

  it('carte malformée est écartée, une carte valide est conservée', () => {
    storage.setItem(
      'choro-srs-v1',
      JSON.stringify({
        cards: {
          bonne: { ease: 2.5, interval: 6, repetitions: 2, due: '2026-09-10', history: [] },
          malformee: { ease: 'pas-un-nombre' },
        },
      }),
    );
    const progress = loadProgress();
    expect(Object.keys(progress.cards)).toEqual(['bonne']);
  });

  it('carte sans `history` (forme héritée) se voit attribuer un historique vide', () => {
    storage.setItem(
      'choro-srs-v1',
      JSON.stringify({
        cards: { a: { ease: 2.5, interval: 6, repetitions: 2, due: '2026-09-10' } },
      }),
    );
    expect(loadProgress().cards.a!.history).toEqual([]);
  });

  it('migre un ancien réglage `maskLevel: 0` en `studyMode: "entiere"`', () => {
    storage.setItem(
      'choro-srs-v1',
      JSON.stringify({ settings: { maskLevel: 0 } }),
    );
    expect(loadProgress().settings.studyMode).toBe('entiere');
  });

  it('migre un ancien réglage `maskLevel: "aucune"` en `studyMode: "sans"`', () => {
    storage.setItem(
      'choro-srs-v1',
      JSON.stringify({ settings: { maskLevel: 'aucune' } }),
    );
    expect(loadProgress().settings.studyMode).toBe('sans');
  });

  it('un `maskLevel` hérité de 80 retombe sur 75 (le palier le plus proche)', () => {
    storage.setItem(
      'choro-srs-v1',
      JSON.stringify({ settings: { maskLevel: 80 } }),
    );
    expect(loadProgress().settings.maskLevel).toBe(75);
  });

  it('un `instrumentDefault` valide est conservé', () => {
    storage.setItem(
      'choro-srs-v1',
      JSON.stringify({ settings: { instrumentDefault: 'eb' } }),
    );
    expect(loadProgress().settings.instrumentDefault).toBe('eb');
  });

  it('un `instrumentDefault` invalide retombe sur `c`', () => {
    storage.setItem(
      'choro-srs-v1',
      JSON.stringify({ settings: { instrumentDefault: 'fa-dièse' } }),
    );
    expect(loadProgress().settings.instrumentDefault).toBe('c');
  });

  it('un `contrechant` valide est conservé', () => {
    storage.setItem(
      'choro-srs-v1',
      JSON.stringify({ settings: { contrechant: 'avec' } }),
    );
    expect(loadProgress().settings.contrechant).toBe('avec');
  });

  it('un `contrechant` invalide retombe sur `sans`', () => {
    storage.setItem(
      'choro-srs-v1',
      JSON.stringify({ settings: { contrechant: 'peut-être' } }),
    );
    expect(loadProgress().settings.contrechant).toBe('sans');
  });

  it('une setlist malformée (sans `id`) est écartée', () => {
    storage.setItem(
      'choro-srs-v1',
      JSON.stringify({
        setlists: [{ name: 'sans id' }, { id: 's1', name: 'Concert' }],
      }),
    );
    const progress = loadProgress();
    expect(progress.setlists).toHaveLength(1);
    expect(progress.setlists[0]!.id).toBe('s1');
  });

  it('`activeSetlistId` pointant une setlist absente est neutralisé', () => {
    storage.setItem(
      'choro-srs-v1',
      JSON.stringify({
        setlists: [{ id: 's1', name: 'Concert' }],
        activeSetlistId: 'ghost',
      }),
    );
    expect(loadProgress().activeSetlistId).toBeNull();
  });

  it('les séances sont plafonnées à 200 au chargement', () => {
    const sessions = Array.from({ length: 250 }, (_, i) => ({
      date: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
      kind: 'deep',
      instrumentId: null,
      setlistId: null,
      setlistName: 'Tout le répertoire',
      songCount: 1,
    }));
    storage.setItem('choro-srs-v1', JSON.stringify({ sessions }));
    expect(loadProgress().sessions).toHaveLength(200);
  });

  it('`localStorage.getItem` qui lève (navigation privée) → progression par défaut', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('stockage indisponible');
      },
    });
    expect(() => loadProgress()).not.toThrow();
    expect(loadProgress().cards).toEqual({});
  });
});
