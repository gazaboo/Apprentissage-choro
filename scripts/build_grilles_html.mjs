import fs from 'node:fs';
import path from 'node:path';

const DIR = new URL('../web/public/data/grilles', import.meta.url).pathname;
const OUT = new URL('../web/public/data/grilles/grilles.html', import.meta.url).pathname;

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
const songs = files.map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function cell(chords) {
  if (!chords || chords.length === 0) return '<div class="cell hold"><span>&middot;</span></div>';
  const inner = chords.map((c) => `<span class="ch">${esc(c)}</span>`).join('<span class="sep"></span>');
  const cls = chords.length > 1 ? 'cell multi' : 'cell';
  return `<div class="${cls}">${inner}</div>`;
}

function grid(seq, startBar) {
  if (!seq || seq.length === 0) return '';
  let rows = '';
  for (let i = 0; i < seq.length; i += 4) {
    const slice = seq.slice(i, i + 4);
    const n = startBar != null ? startBar + i : null;
    const cells = slice.map(cell).join('');
    const pad = Array.from({ length: 4 - slice.length }, () => '<div class="cell pad"></div>').join('');
    rows += `<div class="row"><span class="barno">${n != null ? n : ''}</span><div class="cells">${cells}${pad}</div></div>`;
  }
  return `<div class="grid">${rows}</div>`;
}

function endingRow(label, seq, cls) {
  if (!seq || !seq.length) return '';
  return `<div class="ending"><span class="etag ${cls || ''}">${label}</span><div class="cells">${seq.map(cell).join('')}</div></div>`;
}
function endings(e) {
  if (!e) return '';
  return endingRow('1<sup>re</sup> fin', e['1']) + endingRow('2<sup>e</sup> fin', e['2']);
}

function firstBar(barsStr) {
  if (!barsStr) return null;
  const m = String(barsStr).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function part(p) {
  const meta = [p.tonic ? `centre&nbsp;: ${esc(p.tonic)}` : null, p.bars ? `mes.&nbsp;${esc(p.bars)}` : null, p.repeat ? 'reprise' : null]
    .filter(Boolean).join('<span class="dot">&middot;</span>');
  const trans = p.transition_in && p.transition_in.length
    ? `<div class="row"><span class="barno"></span><div class="cells"><span class="translbl">transition&nbsp;:</span>${p.transition_in.map(cell).join('')}</div></div>` : '';
  const pcoda = p.coda && p.coda.length
    ? `<div class="subcoda"><span class="etag coda">coda</span>${grid(p.coda, null)}</div>` : '';
  return `<section class="part">
    <div class="part-head"><h3>${esc(p.name)}</h3><p class="part-meta">${meta}</p></div>
    ${trans}${grid(p.sequence, firstBar(p.bars))}
    ${endings(p.endings)}${pcoda}
  </section>`;
}

function song(s, idx) {
  const conf = s.confidence || 'medium';
  const badge = { high: 'sûre', medium: 'moyenne', low: 'à revoir' }[conf] || conf;
  const notes = (s.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
  const coda = s.coda && s.coda.length
    ? `<section class="part"><div class="part-head"><h3>Coda</h3></div>${grid(s.coda, null)}</section>` : '';
  const codaNote = s.coda_note ? `<p class="coda-note">${esc(s.coda_note)}</p>` : '';
  return `<article class="song" id="${esc(s.song_id)}">
    <header class="song-head">
      <div class="song-title">
        <span class="song-idx">${String(idx + 1).padStart(2, '0')}</span>
        <div>
          <h2>${esc(s.title)}</h2>
          <p class="composer">${esc(s.composer)}</p>
        </div>
      </div>
      <div class="song-tags">
        <span class="tag">${esc(s.meter || '')}${s.genre ? ' &middot; ' + esc(s.genre) : ''}</span>
        <span class="tag conf conf-${conf}">transcription ${badge}</span>
      </div>
    </header>
    ${s.form ? `<p class="form"><span class="form-lbl">Forme</span> ${esc(s.form)}</p>` : ''}
    <div class="parts">
      ${(s.parts || []).map(part).join('')}
      ${coda}
    </div>
    ${codaNote}
    ${notes ? `<div class="notes"><span class="notes-lbl">À vérifier</span><ul>${notes}</ul></div>` : ''}
  </article>`;
}

const toc = songs.map((s, i) => `<a href="#${esc(s.song_id)}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}</a>`).join('');

const html = `<title>Grilles de choro</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=DM+Mono:wght@400;500&display=swap">
<style>
  :root {
    --paper: #faf8f4;
    --panel: #f2eee6;
    --ink: #201d1b;
    --ink-soft: #746c65;
    --rule: #e7e0d4;
    --rule-strong: #d8cfbf;
    --accent: #7a2e43;
    --accent-soft: #efe1e4;
    --hold: #b8ac9c;
    --conf-high: #4a7c59;
    --conf-med: #a97b2b;
    --conf-low: #9c5442;
    --shadow: 0 1px 2px rgba(32,29,27,.05), 0 8px 24px -12px rgba(32,29,27,.12);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #16141a;
      --panel: #1f1c24;
      --ink: #ece7e2;
      --ink-soft: #9a928b;
      --rule: #302b34;
      --rule-strong: #423b48;
      --accent: #d68aa0;
      --accent-soft: #2b1f27;
      --hold: #5c554f;
      --conf-high: #83b993;
      --conf-med: #d7a552;
      --conf-low: #cc8069;
      --shadow: 0 1px 2px rgba(0,0,0,.3), 0 10px 30px -14px rgba(0,0,0,.5);
    }
  }
  :root[data-theme="dark"] {
    --paper: #16141a;
    --panel: #1f1c24;
    --ink: #ece7e2;
    --ink-soft: #9a928b;
    --rule: #302b34;
    --rule-strong: #423b48;
    --accent: #d68aa0;
    --accent-soft: #2b1f27;
    --hold: #5c554f;
    --conf-high: #83b993;
    --conf-med: #d7a552;
    --conf-low: #cc8069;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 10px 30px -14px rgba(0,0,0,.5);
  }

  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 1.5rem; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: 'Newsreader', Georgia, serif;
    font-size: 17px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 940px; margin: 0 auto; padding: clamp(1.25rem, 4vw, 3.5rem) clamp(1rem, 4vw, 2rem) 6rem; }

  h1, h2, h3 { font-family: 'Bricolage Grotesque', 'Newsreader', sans-serif; font-weight: 700; text-wrap: balance; line-height: 1.1; margin: 0; }

  .masthead { border-bottom: 2px solid var(--ink); padding-bottom: 1.5rem; margin-bottom: 2rem; }
  .masthead h1 { font-size: clamp(2rem, 6vw, 3.1rem); letter-spacing: -0.02em; }
  .masthead .sub { font-size: 1.05rem; color: var(--ink-soft); margin: 0.6rem 0 0; max-width: 60ch; }
  .kicker { font-family: 'DM Mono', monospace; font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); margin: 0 0 0.5rem; }

  .caveat {
    background: var(--accent-soft);
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--accent);
    border-radius: 3px;
    padding: 1rem 1.15rem;
    margin: 1.75rem 0 2.5rem;
    font-size: 0.95rem;
  }
  .caveat strong { font-family: 'Bricolage Grotesque', sans-serif; }
  .caveat p { margin: 0.4rem 0 0; }
  .caveat p:first-child { margin-top: 0; }

  .toc { columns: 2; column-gap: 2rem; margin: 0 0 3.5rem; padding: 1.25rem 0 0; border-top: 1px solid var(--rule); }
  @media (max-width: 560px) { .toc { columns: 1; } }
  .toc a {
    display: flex; gap: 0.7rem; align-items: baseline;
    text-decoration: none; color: var(--ink);
    padding: 0.28rem 0; break-inside: avoid;
    font-size: 0.95rem;
  }
  .toc a span { font-family: 'DM Mono', monospace; font-size: 0.78rem; color: var(--ink-soft); }
  .toc a:hover { color: var(--accent); }

  .song { padding-top: 2.5rem; margin-top: 2.5rem; border-top: 1px solid var(--rule); }
  .song:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
  .song-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 0.75rem 1.5rem; }
  .song-title { display: flex; gap: 1rem; align-items: baseline; }
  .song-idx { font-family: 'DM Mono', monospace; font-size: 0.9rem; color: var(--accent); padding-top: 0.15rem; }
  .song-head h2 { font-size: clamp(1.5rem, 3.5vw, 2rem); letter-spacing: -0.015em; }
  .composer { margin: 0.2rem 0 0; color: var(--ink-soft); font-style: italic; font-size: 0.98rem; }
  .song-tags { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .tag {
    font-family: 'DM Mono', monospace; font-size: 0.68rem; letter-spacing: 0.06em;
    text-transform: uppercase; padding: 0.28rem 0.55rem; border-radius: 999px;
    border: 1px solid var(--rule-strong); color: var(--ink-soft); white-space: nowrap;
  }
  .tag.conf { border-color: transparent; }
  .conf-high { background: color-mix(in srgb, var(--conf-high) 16%, transparent); color: var(--conf-high); }
  .conf-medium { background: color-mix(in srgb, var(--conf-med) 16%, transparent); color: var(--conf-med); }
  .conf-low { background: color-mix(in srgb, var(--conf-low) 18%, transparent); color: var(--conf-low); }

  .form { margin: 1rem 0 0; font-size: 0.95rem; color: var(--ink-soft); }
  .form-lbl { font-family: 'DM Mono', monospace; font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); margin-right: 0.5rem; }

  .parts { margin-top: 1.5rem; display: flex; flex-direction: column; gap: 1.75rem; }
  .part-head { display: flex; align-items: baseline; gap: 0.9rem; margin-bottom: 0.7rem; }
  .part-head h3 { font-size: 1.05rem; letter-spacing: 0.01em; }
  .part-meta { margin: 0; font-family: 'DM Mono', monospace; font-size: 0.72rem; color: var(--ink-soft); }
  .part-meta .dot { margin: 0 0.4rem; opacity: 0.5; }

  .grid { display: flex; flex-direction: column; gap: 0.4rem; overflow-x: auto; }
  .row { display: flex; align-items: stretch; gap: 0.6rem; min-width: max-content; }
  .barno {
    flex: 0 0 1.6rem; text-align: right; align-self: center;
    font-family: 'DM Mono', monospace; font-size: 0.72rem; color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }
  .cells { display: flex; gap: 0.4rem; }
  .ending .cells, .row .cells { flex-wrap: nowrap; }
  .cell {
    flex: 0 0 6.2rem; min-height: 2.9rem;
    display: flex; align-items: center; justify-content: center; gap: 0;
    border: 1px solid var(--rule-strong); border-radius: 3px;
    background: var(--panel);
    font-family: 'DM Mono', monospace; font-size: 0.95rem; font-weight: 500;
    padding: 0.3rem 0.4rem; text-align: center;
  }
  @media (max-width: 560px) { .cell { flex-basis: 5rem; font-size: 0.85rem; } }
  .cell .ch { white-space: nowrap; }
  .cell.multi { font-size: 0.8rem; gap: 0.35rem; }
  .cell.multi .sep { width: 1px; align-self: stretch; background: var(--rule-strong); margin: 0.35rem 0; }
  .cell.hold { color: var(--hold); background: transparent; border-style: dashed; font-size: 1.1rem; }
  .cell.pad { border: none; background: transparent; }

  .ending { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.4rem; padding-left: 2.2rem; max-width: 100%; overflow-x: auto; }
  .subcoda { margin-top: 0.6rem; padding-left: 2.2rem; }
  .subcoda .etag { display: block; margin-bottom: 0.35rem; }
  .etag {
    flex: 0 0 auto; font-family: 'DM Mono', monospace; font-size: 0.68rem;
    letter-spacing: 0.05em; color: var(--accent); text-transform: uppercase;
    min-width: 3.4rem;
  }
  .etag.coda { color: var(--ink-soft); }
  .etag sup { font-size: 0.8em; }
  .translbl { font-family: 'DM Mono', monospace; font-size: 0.7rem; color: var(--ink-soft); align-self: center; margin-right: 0.2rem; }

  .coda-note { margin: 0.9rem 0 0; padding-left: 2.2rem; font-size: 0.9rem; color: var(--ink-soft); font-style: italic; }

  .notes {
    margin-top: 1.5rem; padding: 0.9rem 1.1rem;
    background: var(--panel); border: 1px solid var(--rule); border-radius: 3px;
  }
  .notes-lbl { font-family: 'DM Mono', monospace; font-size: 0.66rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--conf-low); }
  .notes ul { margin: 0.5rem 0 0; padding-left: 1.1rem; }
  .notes li { font-size: 0.9rem; margin: 0.3rem 0; color: var(--ink-soft); }

  a:focus-visible, .toc a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }

  footer { margin-top: 5rem; padding-top: 1.5rem; border-top: 2px solid var(--ink); font-size: 0.85rem; color: var(--ink-soft); }
  footer code { font-family: 'DM Mono', monospace; font-size: 0.85em; background: var(--panel); padding: 0.1rem 0.35rem; border-radius: 3px; }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="kicker">Répertoire &middot; transposition Ut / C</p>
    <h1>Grilles de choro</h1>
    <p class="sub">Les grilles d'accords des 19 morceaux du répertoire, transcrites à la vue depuis les partitions <code style="font-family:'DM Mono',monospace;font-size:.85em">data/&lt;morceau&gt;/c/</code>. Un document de relecture — à comparer aux partitions dans l'appli.</p>
  </header>

  <div class="caveat">
    <strong>Ce document est une première passe, à vérifier.</strong>
    <p>La <em>suite</em> et la <em>nature</em> des accords sont fiables. En revanche, l'<em>alignement mesure&nbsp;par&nbsp;mesure</em> et le <em>découpage des barres à deux accords</em> sont approximatifs — surtout dans les passages arpégés où peu de chiffrages sont écrits.</p>
    <p>Une case <span style="font-family:'DM Mono',monospace;color:var(--hold)">&middot;</span> pointillée&nbsp;= on tient l'accord précédent. Le badge <em>transcription</em> de chaque morceau indique le niveau de confiance.</p>
  </div>

  <nav class="toc">${toc}</nav>

  ${songs.map(song).join('\n')}

  <footer>
    Généré le 8&nbsp;septembre&nbsp;2026 &middot; source JSON&nbsp;: <code>web/public/data/grilles/&lt;morceau&gt;.json</code> &middot; ${songs.length}&nbsp;morceaux.
  </footer>
</div>
`;

fs.writeFileSync(OUT, html);
console.log('wrote', OUT, html.length, 'bytes');
