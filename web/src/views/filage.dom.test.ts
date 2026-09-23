import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderFilage, type FilageContext } from './filage';
import { createFakePlayer } from '../../test/fakes/player';
import type { Song } from '../types';

function song(id: string, title = id): Song {
  return {
    id,
    title,
    composer: 'Compositeur',
    audio: {
      reference: {
        file: `data/${id}/audio/reference.abcd1234.opus`,
        duration: 180,
        source_url: `https://youtube.com/watch?v=${id}`,
      },
      playback: null,
    },
    instruments: [{ id: 'c', name: 'Ut', page_count: 0, measure_count: 0, pages: [] }],
    contraponto: null,
  };
}

function mount(order: Song[], overrides: Partial<FilageContext> = {}) {
  const root = document.createElement('div');
  const player = createFakePlayer();
  const context: FilageContext = {
    player,
    order,
    instrumentId: 'c',
    audioKind: 'reference',
    setlistName: 'Concert du 12',
    markReached: vi.fn(),
    navigateHome: vi.fn(),
    onFinish: vi.fn(),
    ...overrides,
  };
  const teardown = renderFilage(root, context);
  return { root, context, player, teardown };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('renderFilage — smoke', () => {
  it('affiche le décompte d\'entrée avec la liste dans l\'ordre du filage', () => {
    const { root, context } = mount([song('a', 'Alpha'), song('b', 'Bravo')]);
    expect(root.textContent).toContain(`Filage · ${context.setlistName}`);
    expect(root.textContent).toContain('Alpha');
    expect(root.textContent).toContain('Bravo');
  });

  it('marque le premier morceau comme atteint dès le montage', () => {
    const { context } = mount([song('a', 'Alpha')]);
    expect(context.markReached).toHaveBeenCalledWith('a');
  });

  it('teardown ne lève pas et n\'ausse aucun minuteur en attente', () => {
    const { teardown } = mount([song('a'), song('b')]);
    expect(() => teardown()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('renderFilage — décompte d\'entrée puis lecture', () => {
  it('appuyer sur le voile d\'intro démarre la lecture tout de suite', () => {
    const { root, player } = mount([song('a', 'Alpha')]);
    const introVeil = root.querySelector('[aria-label="Démarrer le filage maintenant"]') as HTMLElement;
    expect(player.isPlaying()).toBe(false);
    introVeil.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(player.isPlaying()).toBe(true);
    expect(introVeil.classList.contains('hidden')).toBe(true);
  });

  it('le décompte d\'entrée écoulé (10 s) démarre la lecture tout seul et s\'arrête', () => {
    const { player } = mount([song('a', 'Alpha')]);
    vi.advanceTimersByTime(10_000);
    expect(player.isPlaying()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('renderFilage — dock de transport', () => {
  it('cliquer lecture/pause bascule le lecteur', () => {
    const { root, player } = mount([song('a', 'Alpha')]);
    const playButton = root.querySelector('button[aria-label="Lecture ou pause"]') as HTMLButtonElement;
    expect(player.isPlaying()).toBe(false);
    playButton.click();
    expect(player.isPlaying()).toBe(true);
  });

  it('« Terminer le filage » appelle onFinish()', () => {
    const { root, context } = mount([song('a')]);
    const finish = root.querySelector('button[aria-label="Terminer le filage"]') as HTMLButtonElement;
    finish.click();
    expect(context.onFinish).toHaveBeenCalledOnce();
  });

  it('« Retour » appelle navigateHome()', () => {
    const { root, context } = mount([song('a')]);
    // Icône ← seule sur mobile, d'où le nom porté par `aria-label` (#153).
    const back = root.querySelector('button[aria-label="Retour"]') as HTMLButtonElement;
    back.click();
    expect(context.navigateHome).toHaveBeenCalledOnce();
  });
});
