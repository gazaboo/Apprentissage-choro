#!/usr/bin/env node
/**
 * Aide à la vérification visuelle par Chromium headless + CDP, seule
 * méthode disponible sur ce projet (l'extension Claude-in-Chrome n'est pas
 * connectée, cf. CLAUDE.md). Encode les pièges déjà rencontrés et
 * documentés en mémoire ("verification-navigateur-cdp") pour ne pas les
 * redécouvrir à chaque session.
 *
 * Utilisation typique, depuis un script jetable de vérification :
 *
 *   import {
 *     launchChromium, waitForCdp, openTab, connect,
 *     setViewport, evaluate, clickSelector, screenshot, stopChromium,
 *     addInitScript,
 *   } from '../scripts/cdp-verify.mjs';
 *
 *   const chromium = launchChromium();
 *   await waitForCdp(chromium.port);
 *   const tab = await openTab(chromium.port, 'http://localhost:5173/#/song/x');
 *   const session = await connect(tab.webSocketDebuggerUrl);
 *   await setViewport(session, 1400, 1000);
 *   await clickSelector(session, '[data-testid="ouvrir"]');
 *   const titre = await evaluate(session, 'document.title');
 *   await screenshot(session, 'docs/fixes/apres.png');
 *   session.close();
 *   stopChromium(chromium);
 *
 * Limite connue, sans contournement : ce Chromium headless annonce
 * `hover: none` et `Emulation.setEmulatedMedia` ne le corrige pas — les
 * règles `@media (hover: hover)` ne peuvent pas être vérifiées ici, il faut
 * demander une vérification manuelle à l'utilisateur.
 *
 * `/tmp` peut être partagé entre jobs en arrière-plan qui tournent en
 * parallèle : `launchChromium` crée par défaut un profil sous le `tmpdir()`
 * du job, jamais directement sous `/tmp`. Si une autre session Claude Code
 * tourne en parallèle dans le même dépôt, isoler la vérification dans un
 * `git worktree` séparé plutôt que de changer de branche dans le
 * répertoire de travail principal.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const CHROMIUM_BIN = process.env.CDP_CHROMIUM_BIN ?? 'chromium-browser';

/** Lance Chromium headless avec un profil dédié. */
export function launchChromium({
  port = 9333,
  headless = true,
  fakeMedia = false,
  profileDir,
  extraArgs = [],
} = {}) {
  const dir = profileDir ?? mkdtempSync(join(tmpdir(), 'cdp-verify-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    ...(headless ? ['--headless=new'] : []),
    // Piège : sans ces flags, getUserMedia() bloque sur une permission
    // jamais accordée en headless ; avec, la permission est auto-accordée
    // et un flux silencieux est fourni.
    ...(fakeMedia
      ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
      : []),
    ...extraArgs,
  ];
  // `detached: true` place Chromium dans son propre groupe de processus :
  // Chromium lance des zygotes/renderers séparés, et `proc.kill()` seul ne
  // tue que le process de tête, laissant les enfants orphelins tourner.
  const proc = spawn(CHROMIUM_BIN, args, { stdio: 'ignore', detached: true });
  return { proc, port, profileDir: dir };
}

/** Tue tout le groupe de processus de Chromium (voir le commentaire dans `launchChromium`). */
export function stopChromium({ proc }) {
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    proc.kill('SIGTERM');
  }
}

async function cdpHttp(port, path, init) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Réponse CDP non-JSON sur ${path} : ${text.slice(0, 200)}`);
  }
}

/** Attend que l'endpoint HTTP CDP réponde après le lancement du process. */
export async function waitForCdp(port, { retries = 50, intervalMs = 100 } = {}) {
  for (let i = 0; i < retries; i += 1) {
    try {
      await cdpHttp(port, '/json/version');
      return;
    } catch {
      await delay(intervalMs);
    }
  }
  throw new Error(`CDP indisponible sur le port ${port} après ${retries * intervalMs}ms`);
}

/** Ouvre un nouvel onglet. Piège : `/json/new` exige le verbe PUT, pas GET. */
export async function openTab(port, url = 'about:blank') {
  return cdpHttp(port, `/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
}

export async function closeTab(port, tabId) {
  await cdpHttp(port, `/json/close/${tabId}`);
}

/** Connexion CDP sur un onglet : requête/réponse par id, sur le WebSocket natif de Node. */
class CdpSession {
  constructor(webSocketDebuggerUrl) {
    this.ws = new WebSocket(webSocketDebuggerUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  ready() {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('WebSocket CDP: échec de connexion')), {
        once: true,
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

export async function connect(webSocketDebuggerUrl) {
  const session = new CdpSession(webSocketDebuggerUrl);
  await session.ready();
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  return session;
}

/**
 * Agrandit le viewport. Piège : le viewport headless par défaut (~800×600)
 * place hors-écran un élément plus bas dans une page longue —
 * `Input.dispatchMouseEvent` à ces coordonnées ne clique alors sur rien,
 * sans la moindre erreur.
 */
export async function setViewport(session, width = 1400, height = 1000, deviceScaleFactor = 1) {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor,
    mobile: false,
  });
}

/**
 * Lit une expression dans la page. À préférer à une capture d'écran pendant
 * le debug (cf. CLAUDE.md, section Vérification) — la capture ne sert qu'à
 * la vérification finale.
 */
export async function evaluate(session, expression, { awaitPromise = false } = {}) {
  const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? JSON.stringify(exceptionDetails));
  }
  return result.value;
}

/** Un vrai événement souris CDP, pas un `.click()` JS (voir `clickSelector`). */
export async function dispatchClick(session, x, y) {
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
}

/**
 * Scrolle l'élément au centre du viewport puis clique dessus avec un vrai
 * événement souris. Piège : un `.click()` en JavaScript ne démarre pas la
 * lecture YouTube (`playVideo()` exige un geste de confiance utilisateur) —
 * seul un événement souris via le protocole le fait.
 */
export async function clickSelector(session, selector) {
  const rect = await evaluate(
    session,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`,
  );
  if (!rect) throw new Error(`Élément introuvable : ${selector}`);
  await dispatchClick(session, rect.x, rect.y);
}

/**
 * Recharge en repassant par `about:blank`. Piège : changer seulement le
 * fragment d'URL ne recharge pas la page — pour tester la relecture du
 * `localStorage` au chargement, il faut une vraie navigation.
 */
export async function reloadVia(session, url) {
  await session.send('Page.navigate', { url: 'about:blank' });
  await session.send('Page.navigate', { url });
}

/**
 * Injecte un script exécuté avant tout script de la page, à chaque
 * navigation suivante (persiste tant que la session reste ouverte). Utile
 * pour intercepter un `fetch` avant que le code de l'app ne l'appelle —
 * impossible à obtenir via `evaluate`, qui ne s'exécute qu'après coup.
 */
export async function addInitScript(session, source) {
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source });
}

export async function screenshot(session, outputPath) {
  const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outputPath, Buffer.from(data, 'base64'));
}

/**
 * Remplace temporairement `getUserMedia` pour observer un état transitoire
 * (permission micro en attente, via `delayMs`) ou une branche d'erreur
 * (permission refusée / pas de micro, via `rejectName`, ex.
 * `'NotAllowedError'` ou `'NotFoundError'`) sans dépendre d'un micro réel.
 */
export async function stubGetUserMedia(session, { delayMs, rejectName } = {}) {
  if (!delayMs && !rejectName) {
    throw new Error('stubGetUserMedia : fournir delayMs ou rejectName');
  }
  const corps = rejectName
    ? `navigator.mediaDevices.getUserMedia = () =>
         Promise.reject(new DOMException('stub', ${JSON.stringify(rejectName)}));`
    : `const __original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
       navigator.mediaDevices.getUserMedia = (...args) =>
         new Promise((resolve) => setTimeout(() => resolve(__original(...args)), ${delayMs}));`;
  await evaluate(session, `(() => { ${corps} true; })()`);
}

// Auto-vérification du module, sans dépendre d'un serveur de dev :
// `node scripts/cdp-verify.mjs --self-test`.
if (process.argv[2] === '--self-test') {
  const html = encodeURIComponent(
    '<!doctype html><title>cdp-verify</title>' +
      '<body style="height:2000px"><button id="b" style="position:absolute;top:1800px" ' +
      'onclick="document.title=\'clique\'">bouton bas de page</button></body>',
  );
  const chromium = launchChromium();
  try {
    await waitForCdp(chromium.port);
    const tab = await openTab(chromium.port, `data:text/html,${html}`);
    const session = await connect(tab.webSocketDebuggerUrl);
    await setViewport(session, 1200, 800);

    const titreInitial = await evaluate(session, 'document.title');
    if (titreInitial !== 'cdp-verify') throw new Error(`titre inattendu : ${titreInitial}`);

    // Le bouton est à y=1800 sur une page de 2000px : hors du viewport par
    // défaut. Sans scrollIntoView, ce clic échouerait silencieusement.
    await clickSelector(session, '#b');
    const titreApres = await evaluate(session, 'document.title');
    if (titreApres !== 'clique') throw new Error(`clic sans effet, titre : ${titreApres}`);

    const sortie = join(mkdtempSync(join(tmpdir(), 'cdp-verify-selftest-')), 'capture.png');
    await screenshot(session, sortie);

    session.close();
    console.log('cdp-verify --self-test : OK');
  } finally {
    stopChromium(chromium);
  }
}
