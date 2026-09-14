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

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});
