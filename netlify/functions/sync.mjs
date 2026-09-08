/**
 * Synchro de la progression entre appareils.
 *
 *   GET  /.netlify/functions/sync?code=<code>  → le JSON stocké, ou 404 si l'identifiant est inconnu
 *   PUT  /.netlify/functions/sync?code=<code>  ← le JSON à stocker (crée l'identifiant)
 *
 * Le « code » est un identifiant secret choisi par l'utilisateur : il sert à la
 * fois d'identité et de clé d'accès. Aucun compte, aucune autre authentification.
 * Stockage : Netlify Blobs (identifiants injectés automatiquement par le
 * runtime Netlify).
 */

import { getStore } from '@netlify/blobs';

const CODE_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
const MAX_BYTES = 1_000_000;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export default async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') ?? '';
  if (!CODE_PATTERN.test(code)) {
    return json(400, { error: 'code invalide' });
  }

  const store = getStore('choro-sync');
  const key = `sync/${code}`;

  if (req.method === 'GET') {
    const data = await store.get(key, { type: 'json' });
    if (data === null) return json(404, { error: 'identifiant inconnu' });
    return json(200, data);
  }

  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX_BYTES) {
      return json(413, { error: 'charge trop volumineuse' });
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json(400, { error: 'corps JSON invalide' });
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return json(400, { error: 'objet JSON attendu' });
    }
    await store.setJSON(key, parsed);
    return json(200, { ok: true });
  }

  return json(405, { error: 'méthode non autorisée' });
};
