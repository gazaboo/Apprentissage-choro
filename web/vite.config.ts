import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Chemins relatifs : le build fonctionne tel quel avec `npx serve dist`,
  // à la racine d'un domaine comme dans un sous-dossier.
  base: './',
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist',
    // Les partitions pèsent ~19 Mo : inutile d'alerter sur la taille des assets.
    assetsInlineLimit: 0,
  },
});
