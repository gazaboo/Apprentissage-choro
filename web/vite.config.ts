import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Chemins relatifs : le build fonctionne tel quel avec `npx serve dist`,
  // à la racine d'un domaine comme dans un sous-dossier.
  base: './',
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Teste l'installabilité en dev (`npm run dev`) sans déployer.
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        lang: 'fr',
        name: 'Choro Grenoble',
        short_name: 'Choros',
        description:
          "Entraînement et mémorisation active du répertoire de choros : partition à trous, session entrelacée et répétition espacée.",
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#09090b',
        theme_color: '#09090b',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/maskable-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Pas d'offline-first pour l'instant (#112) : on précache seulement le
        // shell applicatif (JS/CSS/HTML), pas web/public/data/ (~200 Mo de
        // partitions, audio, images) qui reste chargé à la demande.
        // La fonte de la grille d'accords (~20 Ko) aussi : sans elle, hors
        // ligne, les chiffrages retomberaient sur une fonte plus large.
        globPatterns: ['index.html', 'assets/**/*.{js,css,woff2}'],
        globIgnores: ['data/**'],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    // Les partitions pèsent ~19 Mo : inutile d'alerter sur la taille des assets.
    assetsInlineLimit: 0,
  },
});
