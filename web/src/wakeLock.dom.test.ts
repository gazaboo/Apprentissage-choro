/** Cycle de vie du verrou d'écran (#170), API Wake Lock simulée. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { holdScreenAwake } from './wakeLock';

class FakeSentinel extends EventTarget {
  released = false;
  readonly type = 'screen';
  release = vi.fn(async () => {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

let sentinels: FakeSentinel[];
let request: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState;

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

const held = () => sentinels.filter((s) => !s.released).length;

beforeEach(() => {
  vi.useFakeTimers();
  sentinels = [];
  visibility = 'visible';
  request = vi.fn(async () => {
    const sentinel = new FakeSentinel();
    sentinels.push(sentinel);
    return sentinel;
  });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  delete (navigator as { wakeLock?: unknown }).wakeLock;
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe('holdScreenAwake', () => {
  it("acquiert le verrou au montage et le relâche en quittant la vue", async () => {
    const release = holdScreenAwake();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledWith('screen');
    expect(held()).toBe(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(held()).toBe(0);
  });

  it("le redemande au retour au premier plan après que le navigateur l'a relâché", async () => {
    const release = holdScreenAwake();
    await vi.advanceTimersByTimeAsync(0);

    // Onglet masqué : le navigateur relâche lui-même le verrou.
    setVisibility('hidden');
    await sentinels[0]!.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(held()).toBe(0);

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
    expect(held()).toBe(1);
    release();
  });

  it('ne redemande pas un verrou déjà tenu', async () => {
    const release = holdScreenAwake();
    await vi.advanceTimersByTimeAsync(0);
    setVisibility('visible');
    document.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    release();
  });

  it("le relâche après une pause prolongée et le reprend au premier geste", async () => {
    const release = holdScreenAwake(1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(held()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(held()).toBe(0);
    // Pas de reprise tant que personne ne touche à rien, même au premier plan.
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
    expect(held()).toBe(1);
    release();
  });

  it('relâche un verrou obtenu après que la vue a été quittée', async () => {
    const release = holdScreenAwake();
    release(); // avant la résolution de la promesse
    await vi.advanceTimersByTimeAsync(0);
    expect(sentinels).toHaveLength(1);
    expect(held()).toBe(0);
  });

  it("n'écoute plus rien une fois la vue quittée", async () => {
    const release = holdScreenAwake();
    await vi.advanceTimersByTimeAsync(0);
    release();
    setVisibility('visible');
    document.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("se dégrade silencieusement sans API ou si la demande est refusée", async () => {
    delete (navigator as { wakeLock?: unknown }).wakeLock;
    expect(() => holdScreenAwake()()).not.toThrow();

    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: vi.fn(() => Promise.reject(new DOMException('refus', 'NotAllowedError'))) },
      configurable: true,
    });
    const release = holdScreenAwake();
    await vi.advanceTimersByTimeAsync(0);
    release();
  });
});
