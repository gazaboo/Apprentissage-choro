#!/usr/bin/env node
/**
 * Balayage systématique des vues de l'app pour un état des lieux visuel
 * (« est-ce que ça a l'air correct, dans l'ensemble ? »), sans dépendre de
 * Claude pour lire chaque capture : le script est déterministe, et produit
 * un `index.html` autonome que l'utilisateur parcourt lui-même.
 *
 * Construit sur `scripts/cdp-verify.mjs` (Chromium headless en CDP, sans
 * Puppeteer/Playwright, cf. CLAUDE.md). Nécessite le serveur de dev lancé à
 * part (`cd web && npm run dev`) — le script échoue explicitement si
 * `--base-url` ne répond pas, plutôt que de produire des captures vides.
 *
 * Usage :
 *   node scripts/capture-ui-verification.mjs [--base-url http://localhost:5173] [--out-dir chemin]
 *
 * Limites connues (documentées plutôt que contournées à tout prix) :
 * - L'écran Consigne (#109) est capturé via la route cachée `#/demo`
 *   (scénario « Deux succès », cf. `views/demo.ts`) plutôt qu'en accumulant
 *   de vraies bonnes notes sur un morceau réel — même mécanisme que le
 *   README documente pour la QA manuelle.
 * - Le résumé de fin de séance « normal » est capturé via un filage (plus
 *   simple à driver qu'une séance de répertoire, qui ouvrirait la modale SRS
 *   à chaque morceau) — le contenu du résumé ne dépend pas du chemin pris.
 * - Pas de capture de la transition entre morceaux ni du décompte de 5 s du
 *   filage (états trop dépendants du minutage pour être fiables).
 * - Pas de variante « identifiant connecté » de la page Compte (dépendrait
 *   d'un code de synchro valide côté serveur).
 * - Les captures de la séance technique (arpèges/gammes) sont sautées avec
 *   un avertissement si le catalogue technique est absent de l'environnement
 *   (`web/public/data/technique/*`) plutôt que de faire échouer tout le run.
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  addInitScript,
  clickSelector,
  connect,
  dispatchClick,
  evaluate,
  launchChromium,
  openTab,
  reloadVia,
  screenshot,
  setViewport,
  stopChromium,
  waitForCdp,
} from './cdp-verify.mjs';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

const BASE_URL = (flag('base-url', 'http://localhost:5173') ?? '').replace(/\/$/, '');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = flag('out-dir', join('docs', 'qa', 'ui-verification', timestamp));

const DESKTOP = { width: 1400, height: 1000 };
const MOBILE = { width: 375, height: 800 };

mkdirSync(OUT_DIR, { recursive: true });

/** Liste des captures produites, dans l'ordre — alimente `index.html`. */
const shots = [];
let counter = 0;

async function capture(session, slug, label, { viewport = DESKTOP } = {}) {
  counter += 1;
  const suffix = viewport === MOBILE ? '-mobile' : '';
  const file = `${String(counter).padStart(2, '0')}-${slug}${suffix}.png`;
  await screenshot(session, join(OUT_DIR, file));
  const size = statSync(join(OUT_DIR, file)).size;
  if (size < 500) {
    console.warn(`⚠ capture suspecte (${size} o) : ${file} — ${label}`);
  }
  shots.push({ file, label, viewport: viewport === MOBILE ? 'mobile (375px)' : 'desktop (1400px)' });
  console.log(`✓ ${file} — ${label}`);
}

// --- Recherche d'éléments par texte, faute de data-testid dans ce dépôt ---

function jsStringArray(values) {
  return `[${values.map((v) => JSON.stringify(v)).join(',')}]`;
}

/**
 * Clique le premier élément visible dont le texte *contient* l'un des
 * `candidates`, en essayant chacun dans l'ordre. Comparaison par inclusion
 * plutôt qu'égalité stricte : certains boutons préfixent le libellé d'un
 * glyphe (« ⚙︎ Réglages »), et un texte qui change selon le contexte (ex. le
 * cycle « Voir la grille » du filage) se couvre en listant ses variantes.
 * Lève si aucun candidat n'est trouvé, sauf `optional: true`.
 */
async function clickByText(session, tag, candidates, { optional = false } = {}) {
  const rect = await evaluate(
    session,
    `(() => {
      const candidates = ${jsStringArray(candidates)};
      const els = Array.from(document.querySelectorAll(${JSON.stringify(tag)}));
      for (const text of candidates) {
        const el = els.find((e) => {
          if (!(e.textContent || '').trim().includes(text)) return false;
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (el) {
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    })()`,
  );
  if (!rect) {
    if (optional) return false;
    throw new Error(`Aucun ${tag} avec l'un des textes : ${candidates.join(' / ')}`);
  }
  await dispatchClick(session, rect.x, rect.y);
  await settle();
  return true;
}

async function clickAriaLabel(session, label) {
  await clickSelector(session, `[aria-label=${JSON.stringify(label)}]`);
  await settle();
}

/**
 * Laisse le temps à `window.location.hash = ...` de déclencher son
 * `hashchange` (asynchrone) et au `render()` de l'app de s'exécuter, avant
 * qu'un appel suivant ne cherche un élément qui n'existe pas encore. Sans
 * ce délai, deux clics consécutifs sans capture entre les deux (donc sans
 * l'aller-retour réseau qui laissait la boucle d'événements respirer) ratent
 * le second.
 */
async function settle(ms = 120) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recharge puis attend que l'app ait rendu quelque chose dans `#app`. Piège :
 * `Page.captureScreenshot` (et parfois d'autres commandes) échoue avec
 * « Not attached to an active page » si on l'appelle juste après
 * `Page.navigate` — la traversée about:blank → origine réelle bascule de
 * process de rendu, et le nouveau frame n'est pas encore prêt à servir des
 * commandes CDP. Un aller-retour `evaluate` réussi suffit à confirmer que le
 * nouveau process répond.
 */
async function goto(session, url, { retries = 30, intervalMs = 200 } = {}) {
  await reloadVia(session, url);
  for (let i = 0; i < retries; i += 1) {
    try {
      const ready = await evaluate(session, `!!document.getElementById('app')?.firstChild`);
      if (ready) return;
    } catch {
      /* frame pas encore prête à répondre : on retente */
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`L'app n'a rien rendu dans #app après navigation vers ${url}`);
}

async function elementExists(session, tag, text) {
  return evaluate(
    session,
    `Array.from(document.querySelectorAll(${JSON.stringify(tag)}))
      .some((e) => (e.textContent || '').trim() === ${JSON.stringify(text)})`,
  );
}

async function seedLocalStorage(session, entries) {
  const assignments = Object.entries(entries)
    .map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
    .join('\n');
  await evaluate(session, `(() => { ${assignments} true; })()`);
}

async function clearProgress(session) {
  await evaluate(session, `(() => { localStorage.removeItem('choro-srs-v1'); true; })()`);
}

async function run() {
  try {
    await fetch(BASE_URL);
  } catch {
    throw new Error(
      `Le serveur de dev ne répond pas sur ${BASE_URL}. Lancer d'abord : cd web && npm run dev`,
    );
  }
  const manifest = await fetch(`${BASE_URL}/data/manifest.json`).then((r) => r.json());
  const songId = manifest[0]?.id;
  if (!songId) throw new Error('Manifeste vide ou introuvable — impossible de choisir un morceau.');

  const chromium = launchChromium();
  try {
    await waitForCdp(chromium.port);
    const tab = await openTab(chromium.port, 'about:blank');
    const session = await connect(tab.webSocketDebuggerUrl);
    await setViewport(session, DESKTOP.width, DESKTOP.height);

    // --- 1. Passerelle d'accueil (profil neuf, rien en localStorage) -----
    await goto(session, `${BASE_URL}/#/`);
    await capture(session, 'compte-gate', "Passerelle d'accueil (premier lancement)");

    // --- 2. Assistant d'accueil : compte choisi, onboarding pas fait -----
    // Un seul écran (deux questions, un seul CTA) : le clic sur « Continuer »
    // complète l'onboarding et renvoie directement au tableau de bord.
    await seedLocalStorage(session, { 'choro-account': 'local' });
    await goto(session, `${BASE_URL}/#/onboarding`);
    await capture(session, 'onboarding', "Assistant d'accueil (réglages par défaut)");
    await clickByText(session, 'button', ['Continuer']);

    // --- 3. Tableau de bord, Compte, Aide ---------------------------------
    await goto(session, `${BASE_URL}/#/`);
    await capture(session, 'dashboard-normal', 'Tableau de bord — état normal');

    await goto(session, `${BASE_URL}/#/compte`);
    await capture(session, 'compte-normal', 'Page Compte (anonyme)');

    await goto(session, `${BASE_URL}/#/aide`);
    await capture(session, 'aide', 'Page Aide — principes de mémorisation');

    // --- 4. Setlists vides (répertoire puis technique) --------------------
    const emptyRepertoireProgress = JSON.stringify({
      cards: {},
      setlists: [{ id: 'qa-vide', name: 'QA — setlist vide', songIds: [], createdAt: new Date().toISOString() }],
      activeSetlistId: 'qa-vide',
      techniqueSetlists: [],
      activeTechniqueSetlistId: null,
      sessions: [],
      _rev: Date.now(),
      settings: {
        blockMinutes: 5,
        display: 'partition',
        studyMode: 'mesures',
        maskLevel: 50,
        maskSeed: 1,
        eclipseIntensity: 'moyennes',
        instrumentDefault: 'c',
        contrechant: 'sans',
        panel: null,
        fullpage: { zoom: 1, twoColumns: true, playerHidden: false },
      },
    });
    await seedLocalStorage(session, { 'choro-srs-v1': emptyRepertoireProgress });
    await goto(session, `${BASE_URL}/#/`);
    await capture(session, 'dashboard-setlist-repertoire-vide', 'Tableau de bord — setlist répertoire vide');

    const emptyTechniqueProgress = JSON.stringify({
      ...JSON.parse(emptyRepertoireProgress),
      setlists: [],
      activeSetlistId: null,
      techniqueSetlists: [
        { id: 'qa-vide-tech', name: 'QA — setlist technique vide', exerciceIds: [], createdAt: new Date().toISOString() },
      ],
      activeTechniqueSetlistId: 'qa-vide-tech',
    });
    await seedLocalStorage(session, { 'choro-srs-v1': emptyTechniqueProgress });
    await goto(session, `${BASE_URL}/#/`);
    await capture(session, 'dashboard-setlist-technique-vide', 'Tableau de bord — setlist technique vide');

    await clearProgress(session);

    // --- 5. Mode démonstration & écran Consigne (#109) ---------------------
    // Route cachée `#/demo` (aucun bouton dans l'UI normale, cf. README) :
    // amorce un morceau par branche de `recommendedMode()` dans un
    // `sessionStorage` dédié, isolé de la vraie progression (déjà nettoyée
    // juste au-dessus). Le scénario « Deux succès » est le seul des cinq à
    // retomber en mode « Sans partition », qui affiche la Consigne.
    await goto(session, `${BASE_URL}/#/demo`);
    await capture(session, 'demo-accueil', 'Mode démonstration — accueil des scénarios');

    const deuxSuccesRect = await evaluate(
      session,
      `(() => {
        const sections = Array.from(document.querySelectorAll('section'));
        const section = sections.find(
          (s) => s.querySelector('h2')?.textContent?.trim() === 'Deux succès',
        );
        const btn = section?.querySelector('button');
        if (!btn) return null;
        btn.scrollIntoView({ block: 'center' });
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`,
    );
    if (!deuxSuccesRect) {
      throw new Error('Bouton du scénario « Deux succès » introuvable en mode démo.');
    }
    await dispatchClick(session, deuxSuccesRect.x, deuxSuccesRect.y);
    await settle();
    await capture(session, 'consigne', 'Écran Consigne — mode recommandé « Sans partition »');

    // Quitte le mode démo (bandeau du haut) avant de poursuivre : tant que le
    // drapeau reste posé, `loadProgress()` lit le `sessionStorage` de démo au
    // lieu du `localStorage` que les étapes suivantes seedent.
    await clickByText(session, 'button', ['Quitter']);

    // --- 6. Entraînement libre sur un morceau (#/song/:id) ----------------
    const songUrl = `${BASE_URL}/#/song/${songId}`;

    await goto(session, songUrl);
    await capture(session, 'song-mode-entiere', 'Entraînement — mode Partition entière');

    // L'ancien bouton « Réglages » a été remplacé par le panneau « Défi »
    // (#109, cf. `sheet.ts`) — seul point d'entrée restant pour changer de
    // mode de lecture depuis cette vue. Éclipses n'y a plus de bouton dédié
    // (seuls les paliers de masquage et « partition entière » le sont :
    // capture sautée) ; Sans partition est déjà couvert par l'écran Consigne
    // capturé plus haut via le mode démonstration.
    await clickByText(session, 'button', ['🎯 Défi']);
    await capture(session, 'song-defi-panel', 'Entraînement — panneau Défi');
    await clickByText(session, 'button', ['Partition masquée à 50 %']);
    await clickAriaLabel(session, 'Fermer le défi');
    await capture(session, 'song-mode-mesures', 'Entraînement — mode Mesures cachées (50 %)');

    await goto(session, songUrl);
    await clickByText(session, 'button', ['Plein écran']);
    await capture(session, 'song-plein-ecran', 'Entraînement — plein écran');

    await goto(session, songUrl);
    // Repli du lecteur : bouton présent seulement si le morceau a de l'audio.
    const foldExists = await evaluate(
      session,
      `!!document.querySelector('[aria-label="Réduire le lecteur"]')`,
    );
    if (foldExists) {
      await clickAriaLabel(session, 'Réduire le lecteur');
      await capture(session, 'song-dock-replie', 'Entraînement — dock de transport replié');
    } else {
      console.warn('⚠ pas de bouton « Réduire le lecteur » (morceau sans audio) — capture sautée.');
    }

    await goto(session, songUrl);
    await setViewport(session, MOBILE.width, MOBILE.height);
    await capture(session, 'song-dock', 'Entraînement — dock de transport (mobile)', { viewport: MOBILE });
    await setViewport(session, DESKTOP.width, DESKTOP.height);

    await goto(session, songUrl);
    await clickByText(session, 'button', ['Terminer et évaluer']);
    await capture(session, 'srs-modal', "Modale d'auto-évaluation (fin de morceau)");

    // --- 7. Séance de répertoire (#/session) -------------------------------
    await goto(session, `${BASE_URL}/#/`);
    const urgentClicked = await clickByText(session, 'button', ['Réviser'], { optional: true });
    if (urgentClicked) {
      await capture(session, 'session-urgente', "Séance — révision des urgences");
      await setViewport(session, MOBILE.width, MOBILE.height);
      await capture(session, 'session', 'Séance — dock de transport (mobile)', { viewport: MOBILE });
      await setViewport(session, DESKTOP.width, DESKTOP.height);
    } else {
      console.warn('⚠ bouton de révision introuvable (répertoire vide ?) — captures de séance sautées.');
    }

    // --- 8. Filage : config, 3 états, résumés ------------------------------
    await goto(session, `${BASE_URL}/#/`);
    await clickByText(session, 'button', ['Préparer un concert']);
    await capture(session, 'filage-config', 'Filage — configuration (partition + bande)');
    await clickByText(session, 'button', ['Commencer le filage']);
    await capture(session, 'filage-partition', 'Filage — zone de partition');
    // Immédiatement terminé, sans progression : résumé "rien travaillé".
    await clickByText(session, 'button', ['Terminer le filage']);
    await capture(session, 'resume-rien-travaille', 'Résumé de fin de séance — rien travaillé');

    await goto(session, `${BASE_URL}/#/`);
    await clickByText(session, 'button', ['Préparer un concert']);
    await clickByText(session, 'button', ['Commencer le filage']);
    await setViewport(session, MOBILE.width, MOBILE.height);
    await capture(session, 'filage', 'Filage — lecteur (mobile)', { viewport: MOBILE });
    await setViewport(session, DESKTOP.width, DESKTOP.height);
    // L'ordre exact des 3 candidats dépend de la disponibilité d'une grille
    // pour ce morceau (sautée si absente) — on les propose tous, `optional`
    // pour ne pas interrompre tout le run si le cycle diffère de l'attendu.
    const cycleLabels = ['Voir la grille', 'Masquer la partition', 'Voir la partition'];
    await clickByText(session, 'button', cycleLabels, { optional: true });
    await capture(session, 'filage-etat-2', 'Filage — 2ᵉ état du cycle (grille ou scène)');
    await clickByText(session, 'button', cycleLabels, { optional: true });
    await capture(session, 'filage-etat-3', 'Filage — 3ᵉ état du cycle');
    await clickByText(session, 'button', ['Terminer le filage']);
    await capture(session, 'resume-normal', 'Résumé de fin de séance — normal');

    // --- 9. Technique (arpèges/gammes), si le catalogue est présent -------
    await goto(session, `${BASE_URL}/#/`);
    const techniqueAvailable = await elementExists(session, 'h2', 'Technique instrumentale');
    if (techniqueAvailable) {
      const opened = await clickByText(session, 'button', ['Commencer', 'Voir les exercices'], {
        optional: true,
      });
      if (opened) {
        await capture(session, 'technique-liste', 'Technique — vue d’ensemble');
        await clickAriaLabel(session, 'Nouvelle setlist de technique');
        await capture(session, 'technique-modal-setlist', 'Technique — édition de setlist');

        await goto(session, `${BASE_URL}/#/`);
        await clickByText(session, 'button', ['Commencer', 'Voir les exercices']);
        // Le bouton "Commencer — N exercices" a un texte dynamique : on le
        // cherche par préfixe plutôt que par égalité exacte.
        const startRect = await evaluate(
          session,
          `(() => {
            const btn = Array.from(document.querySelectorAll('button'))
              .find((e) => (e.textContent || '').trim().startsWith('Commencer —'));
            if (!btn) return null;
            btn.scrollIntoView({ block: 'center' });
            const r = btn.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          })()`,
        );
        if (startRect) {
          await dispatchClick(session, startRect.x, startRect.y);
          await capture(session, 'technique-run-masque', 'Technique — séance (notes masquées)');
          await setViewport(session, MOBILE.width, MOBILE.height);
          await capture(session, 'technique-run', 'Technique — séance (mobile)', { viewport: MOBILE });
          await setViewport(session, DESKTOP.width, DESKTOP.height);
          await clickByText(session, 'button', ['Voir les notes']);
          await capture(session, 'technique-run-revele', 'Technique — séance (notes révélées)');
        } else {
          console.warn('⚠ rien à réviser en technique aujourd’hui — captures de séance sautées.');
        }
      } else {
        console.warn('⚠ section Technique sans bouton de démarrage — captures sautées.');
      }
    } else {
      console.warn('⚠ catalogue technique absent de cet environnement — bloc technique sauté.');
    }

    // --- 10. Modale d'édition de setlist répertoire -------------------------
    await goto(session, `${BASE_URL}/#/`);
    await clickAriaLabel(session, 'Nouvelle setlist');
    await capture(session, 'setlist-modal', 'Modale d’édition de setlist (répertoire)');

    session.close();

    // --- 11. Écran d'erreur : manifeste inatteignable ----------------------
    // Dans un onglet séparé : le script injecté doit précéder le chargement
    // du bundle de l'app, impossible à garantir sur l'onglet déjà navigué.
    const errorTab = await openTab(chromium.port, 'about:blank');
    const errorSession = await connect(errorTab.webSocketDebuggerUrl);
    await setViewport(errorSession, DESKTOP.width, DESKTOP.height);
    await addInitScript(
      errorSession,
      `(() => {
        const original = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : input.url;
          if (url && url.includes('manifest.json')) return Promise.reject(new TypeError('QA: échec simulé'));
          return original(input, init);
        };
      })();`,
    );
    await goto(errorSession, `${BASE_URL}/#/`);
    await capture(errorSession, 'erreur-chargement', 'Écran d’erreur — manifeste inatteignable');
    errorSession.close();

    writeIndex();
    console.log(`\n${shots.length} captures écrites dans ${OUT_DIR}/index.html`);
  } finally {
    stopChromium(chromium);
  }
}

function writeIndex() {
  const cards = shots
    .map(
      (s, i) => `
        <figure>
          <img src="${s.file}" loading="lazy" alt="${escapeHtml(s.label)}">
          <figcaption>${String(i + 1).padStart(2, '0')} — ${escapeHtml(s.label)}
            <span class="viewport">${s.viewport}</span>
          </figcaption>
        </figure>`,
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Vérification UI — ${escapeHtml(timestamp)}</title>
<style>
  body { margin: 0; padding: 2rem; background: #18181b; color: #e4e4e7; font: 15px/1.4 system-ui, sans-serif; }
  h1 { font-size: 1.2rem; font-weight: 600; }
  p.meta { color: #a1a1aa; font-size: 0.85rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.25rem; margin-top: 1.5rem; }
  figure { margin: 0; background: #27272a; border-radius: 10px; overflow: hidden; }
  figure img { width: 100%; display: block; background: #000; }
  figcaption { padding: 0.6rem 0.75rem; font-size: 0.8rem; color: #d4d4d8; }
  figcaption .viewport { display: block; color: #71717a; font-size: 0.7rem; margin-top: 0.2rem; }
</style>
</head>
<body>
  <h1>Vérification UI générale — ${shots.length} captures</h1>
  <p class="meta">Généré le ${escapeHtml(new Date().toLocaleString('fr-FR'))} — regénérer avec
    <code>node scripts/capture-ui-verification.mjs</code>.</p>
  <div class="grid">${cards}</div>
</body>
</html>`;
  writeFileSync(join(OUT_DIR, 'index.html'), html);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

await run();
