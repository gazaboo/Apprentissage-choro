import { afterEach, describe, expect, it } from 'vitest';
import { initAnalytics } from './analytics';

function scriptTag(): HTMLScriptElement | null {
  return document.getElementById('umami-analytics') as HTMLScriptElement | null;
}

afterEach(() => {
  scriptTag()?.remove();
});

describe('initAnalytics', () => {
  it("n'injecte rien hors production", () => {
    initAnalytics({ PROD: false, VITE_UMAMI_WEBSITE_ID: 'site-1' });
    expect(scriptTag()).toBeNull();
  });

  it("n'injecte rien sans identifiant de site configuré", () => {
    initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: undefined });
    expect(scriptTag()).toBeNull();
  });

  it('injecte le script Umami Cloud par défaut en production avec un identifiant', () => {
    initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: 'site-1' });
    const script = scriptTag();
    expect(script).not.toBeNull();
    expect(script?.src).toBe('https://cloud.umami.is/script.js');
    expect(script?.dataset.websiteId).toBe('site-1');
    expect(script?.defer).toBe(true);
  });

  it('utilise une URL de script personnalisée (self-host) si fournie', () => {
    initAnalytics({
      PROD: true,
      VITE_UMAMI_WEBSITE_ID: 'site-1',
      VITE_UMAMI_SCRIPT_URL: 'https://umami.example.org/script.js',
    });
    expect(scriptTag()?.src).toBe('https://umami.example.org/script.js');
  });

  it("n'injecte le script qu'une seule fois", () => {
    initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: 'site-1' });
    initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: 'site-1' });
    expect(document.head.querySelectorAll('#umami-analytics')).toHaveLength(1);
  });
});
