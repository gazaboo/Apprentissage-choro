import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';

// jsdom n'implémente pas `matchMedia` : plusieurs vues (trainer.ts, sheet.ts)
// l'appellent au montage pour adapter leur mise en page desktop/mobile.
// Repos par défaut sur `matches: false` (mobile) ; un test peut le remplacer.
beforeEach(() => {
  // jsdom expose `window.matchMedia` mais le fait lever ("not implemented") à
  // l'appel : on écrase systématiquement, pas de garde `??` possible.
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
});

// jsdom n'implémente pas la capture de pointeur, dont se servent tous les
// gestes de glissement du dock (défilement `transport.ts`, tracé de la frise,
// déplacement du panneau Défi `sheet.ts`). Sans ces doublures, le premier
// `pointerdown` lève et le test échoue avant d'avoir rien vérifié.
Element.prototype.setPointerCapture ??= function setPointerCapture(): void {};
Element.prototype.releasePointerCapture ??= function releasePointerCapture(): void {};
Element.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
  return false;
};

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});
