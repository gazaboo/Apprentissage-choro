/** Thème clair/sombre (#177) : préférence par appareil, comme l'onboarding —
 *  pas de champ dans `Progress`, donc pas de synchro entre appareils.
 *
 *  Le script en tête de `index.html` lit déjà `choro-theme` et pose
 *  `data-theme` sur `<html>` avant le premier rendu, pour éviter un flash du
 *  mauvais thème. Ce module ne fait qu'exposer la même logique côté JS, pour
 *  lire l'état courant et le faire évoluer depuis les réglages.
 */

export type Theme = 'dark' | 'light';

const THEME_KEY = 'choro-theme';

export function getTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* stockage indisponible : le thème ne survivra pas au rechargement */
  }
  applyTheme(theme);
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute('content', theme);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#fafafa' : '#09090b');
}
