import { describe, expect, it } from 'vitest';
import { mountSectionShell, techniqueDueToday } from './nav';
import type { SessionRun } from '../types';

function run(kind: SessionRun['kind'], date: Date): SessionRun {
  return {
    date: date.toISOString(),
    kind,
    instrumentId: null,
    setlistId: null,
    setlistName: 'Tout le répertoire',
    songCount: 3,
  } as SessionRun;
}

describe('techniqueDueToday', () => {
  const now = new Date(2026, 8, 23, 18, 0);

  it('vrai sans aucune séance', () => {
    expect(techniqueDueToday({ sessions: [] }, now)).toBe(true);
  });

  it('faux dès qu’une séance technique a eu lieu le jour même', () => {
    const sessions = [run('technique', new Date(2026, 8, 23, 0, 5))];
    expect(techniqueDueToday({ sessions }, now)).toBe(false);
  });

  it('vrai si la dernière séance technique date de la veille au soir', () => {
    const sessions = [run('technique', new Date(2026, 8, 22, 23, 55))];
    expect(techniqueDueToday({ sessions }, now)).toBe(true);
  });

  it('ignore les séances de répertoire du jour', () => {
    const sessions = [run('deep', now), run('urgent', now), run('filage', now)];
    expect(techniqueDueToday({ sessions }, now)).toBe(true);
  });

  it('compare le jour calendaire, pas seulement le jour du mois', () => {
    const sessions = [run('technique', new Date(2026, 7, 23, 12, 0))];
    expect(techniqueDueToday({ sessions }, now)).toBe(true);
  });
});

describe('mountSectionShell', () => {
  function labels(root: HTMLElement, nav: number): string[] {
    const navs = root.querySelectorAll('nav');
    return [...navs[nav]!.querySelectorAll('a')].map((a) => a.textContent ?? '');
  }

  it('rend le rail et la barre du bas, et marque la section active', () => {
    const root = document.createElement('div');
    const content = mountSectionShell(root, { active: 'aide', hasTechnique: true, techniqueDue: false });
    expect(root.querySelectorAll('nav')).toHaveLength(2);
    expect(labels(root, 1)).toEqual(['Répertoire', 'Technique', 'Compte', 'Aide']);
    const current = [...root.querySelectorAll('a[aria-current="page"]')];
    expect(current).toHaveLength(2);
    expect(current.every((a) => a.getAttribute('href') === '#/aide')).toBe(true);
    expect(root.contains(content)).toBe(true);
  });

  it('masque « Technique » quand le catalogue est absent', () => {
    const root = document.createElement('div');
    mountSectionShell(root, { active: 'repertoire', hasTechnique: false, techniqueDue: true });
    expect(labels(root, 1)).toEqual(['Répertoire', 'Compte', 'Aide']);
  });

  it('pose la pastille sur « Technique » seulement si elle est due et non active', () => {
    const root = document.createElement('div');
    mountSectionShell(root, { active: 'repertoire', hasTechnique: true, techniqueDue: true });
    expect(root.textContent).toContain('pas encore travaillée aujourd’hui');

    mountSectionShell(root, { active: 'technique', hasTechnique: true, techniqueDue: true });
    expect(root.textContent).not.toContain('pas encore travaillée aujourd’hui');
  });
});
