/** Mesure d'audience via Umami (umami.is) : cookieless, script < 2 Ko.
 *
 * Le script n'est injecté qu'en production ET si un identifiant de site a
 * été fourni au build (variable Netlify `VITE_UMAMI_WEBSITE_ID`) — ainsi les
 * builds locaux et les déploiements de prévisualisation ne polluent pas les
 * statistiques (issue #113).
 */

const SCRIPT_ELEMENT_ID = 'umami-analytics';
const DEFAULT_SCRIPT_URL = 'https://cloud.umami.is/script.js';

export function initAnalytics(
  env: Pick<ImportMetaEnv, 'PROD' | 'VITE_UMAMI_WEBSITE_ID' | 'VITE_UMAMI_SCRIPT_URL'> = import
    .meta.env,
): void {
  const websiteId = env.VITE_UMAMI_WEBSITE_ID;
  if (!env.PROD || !websiteId) return;
  if (document.getElementById(SCRIPT_ELEMENT_ID)) return;

  const script = document.createElement('script');
  script.id = SCRIPT_ELEMENT_ID;
  script.defer = true;
  script.src = env.VITE_UMAMI_SCRIPT_URL || DEFAULT_SCRIPT_URL;
  script.dataset.websiteId = websiteId;
  document.head.appendChild(script);
}
