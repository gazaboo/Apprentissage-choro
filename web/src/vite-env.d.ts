/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Identifiant de site Umami (issue #113) ; absent = analytics désactivées. */
  readonly VITE_UMAMI_WEBSITE_ID?: string;
  /** URL du script Umami ; défaut : Umami Cloud (`https://cloud.umami.is/script.js`). */
  readonly VITE_UMAMI_SCRIPT_URL?: string;
}
