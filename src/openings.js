// Entraînement au répertoire d'ouvertures (répétition espacée, façon Chessable).
import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { loadSettings, onSettingsChanged } from './settings.js';
import { renderSettings } from './settings-ui.js';
import { parsePgnTree } from './pgn-tree.js';
import { getRepertoires, saveRepertoires, getRepStats, saveRepStats, deleteRepertoire } from './storage.js';
import { configureSound, play, playForMove } from './sound.js';
import { icon, hydrateIcons } from './icons.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const epd = fen => fen.split(' ').slice(0, 4).join(' ');
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const LEVELS = [4 * HOUR, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 90 * DAY, 180 * DAY];
const MODE_LABEL = { learn: 'Apprendre', review: 'Réviser', drill: 'Entraînement libre', browse: 'Parcourir' };

let settings, board;
let reps = [], rep = null, G = null, stats = {};
let library = [], libColor = 'w';
let sess = null, browse = null;
let token = 0;

/* ====================================================================== */

async function init() {
  hydrateIcons();
  settings = await loadSettings();
  configureSound(settings);
  onSettingsChanged(s => { settings = s; });
  board = new Board($('board'), {
    theme: settings.boardTheme, pieceSet: settings.pieceSet, coords: settings.showCoords,
    animMs: settings.animationMs, autoQueen: true, getDests, onMove,
  });
  board.setPosition(new Chess().fen(), { animate: false });

  $('rep-select').onchange = e => selectRep(e.target.value);
  $('rep-delete').onclick = async () => {
    if (!rep) return;
    if (rep.source === 'encroissant') {
      if (!confirm(`Masquer « ${rep.name} » ? (il vient d'En Croissant ; votre progression est conservée)`)) return;
      rep.hidden = true;
      await persist();
    } else if (rep.source === 'library') {
      if (!confirm(`Retirer « ${rep.name} » de vos répertoires ? (votre progression est conservée)`)) return;
      reps = reps.filter(r => r.id !== rep.id);
      await persist();
    } else {
      if (!confirm(`Supprimer le répertoire « ${rep.name} » et sa progression ?`)) return;
      await deleteRepertoire(rep.id);
      reps = await getRepertoires();
    }
    selectRep(visible()[0]?.id);
  };
  $('btn-train').onclick = () => startSession(bestMode());
  $('mode-learn').onclick = () => startSession('learn');
  $('mode-review').onclick = () => startSession('review');
  $('mode-drill').onclick = () => startSession('drill');
  $('mode-browse').onclick = () => startBrowse();
  $('btn-next-line').onclick = () => sess && nextLine();
  $('btn-hint').onclick = hint;
  $('btn-show').onclick = showAnswer;
  $('btn-quit').onclick = endSession;
  $('btn-back').onclick = browseBack;
  $('btn-analyze').onclick = () => {
    const fen = currentFen();
    window.open(`app.html?explore=1&fen=${encodeURIComponent(fen)}`, '_blank');
  };
  setupImport();
  $('btn-settings-top').onclick = async () => {
    $('settings-modal').hidden = false;
    await renderSettings($('settings-body'), s => {
      settings = s;
      configureSound(s);
      board.setOptions({ theme: s.boardTheme, pieceSet: s.pieceSet, coords: s.showCoords, animMs: s.animationMs });
    });
  };
  $('settings-close').onclick = () => { $('settings-modal').hidden = true; };
  document.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (e.key === 'Enter' && sess?.done) nextLine();
    else if (e.key === 'h') hint();
    else if (e.key === 'Escape') endSession();
    else if (e.key === 'ArrowLeft' && browse) browseBack();
  });

  await loadLibrary();
  reps = await syncBuiltins(await getRepertoires());
  const last = localStorageGet('lastRep');
  await selectRep(visible().find(r => r.id === last)?.id || visible()[0]?.id);
}

const visible = () => reps.filter(r => !r.hidden);

/** Sauvegarde la liste ; les PGN de la bibliothèque ne sont pas recopiés (ils sont dans l'extension). */
function persist() {
  return saveRepertoires(reps.map(r => r.source === 'library' ? { ...r, pgn: undefined } : r));
}

async function ensurePgn(r) {
  if (r && !r.pgn && r.source === 'library') {
    r.pgn = await (await fetch('../data/repertoires/library/' + encodeURIComponent(r.file))).text();
  }
  return r;
}

async function loadLibrary() {
  try {
    const res = await fetch('../data/repertoires/library/index.json');
    library = res.ok ? await res.json() : [];
  } catch { library = []; }
}

/** Ajoute un répertoire de la bibliothèque à « mes répertoires » et le sélectionne. */
async function addFromLibrary(item, train) {
  const id = 'lib:' + item.file;
  let r = reps.find(x => x.id === id);
  if (!r) {
    r = { id, source: 'library', file: item.file, name: item.name, color: item.color, created: Date.now(), author: item.author, url: item.url };
    reps.push(r);
    await persist();
  }
  r.hidden = false;
  await selectRep(id);
  if (train) startSession(bestMode());
}

function renderLibrary() {
  const box = $('library');
  if (!library.length) { box.hidden = true; return; }
  box.hidden = false;
  const items = library.filter(x => x.color === libColor);
  box.innerHTML = `
    <div class="lib-head">
      <div class="rep-list-title">Bibliothèque d'ouvertures</div>
      <div class="seg">
        <button class="${libColor === 'w' ? 'on' : ''}" data-c="w"><img src="../img/pieces/${settings.pieceSet}/wK.svg" alt="">Blancs</button>
        <button class="${libColor === 'b' ? 'on' : ''}" data-c="b"><img src="../img/pieces/${settings.pieceSet}/bK.svg" alt="">Noirs</button>
      </div>
    </div>
    <div class="lib-list">${items.map(it => {
      const mine = reps.some(r => r.id === 'lib:' + it.file && !r.hidden);
      return `<div class="lib-item" data-file="${esc(it.file)}">
        <div class="lib-txt"><b>${esc(it.name)}</b><span>${esc(it.description || '')}</span>
          <small>${it.moves} coups · ${it.chapters} chapitre${it.chapters > 1 ? 's' : ''}${it.author ? ` · étude Lichess de ${esc(it.author)}` : ''}</small></div>
        <div class="lib-actions">
          <button class="btn btn-sm btn-primary" data-act="train">${icon('play', 13)}S'entraîner</button>
          ${mine ? `<span class="lib-added">${icon('check', 13)}Ajouté</span>` : `<button class="btn btn-sm" data-act="add">${icon('plus', 13)}Ajouter</button>`}
        </div>
      </div>`;
    }).join('')}</div>`;
  box.querySelectorAll('.seg button').forEach(b => b.onclick = () => { libColor = b.dataset.c; renderLibrary(); });
  box.querySelectorAll('.lib-item').forEach(el => {
    const it = library.find(x => x.file === el.dataset.file);
    el.querySelector('[data-act="train"]').onclick = () => addFromLibrary(it, true);
    const add = el.querySelector('[data-act="add"]');
    if (add) add.onclick = () => addFromLibrary(it, false);
  });
}

function guessColor(text, name) {
  const h = parsePgnTree(text)[0]?.headers || {};
  if (/^black$/i.test(h.Orientation || '')) return 'b';
  if (/^white$/i.test(h.Orientation || '')) return 'w';
  return /black|noirs?/i.test(name) ? 'b' : 'w';
}

/** Charge les répertoires d'En Croissant copiés dans l'extension (data/repertoires). */
async function syncBuiltins(list) {
  let index = [];
  try {
    const r = await fetch('../data/repertoires/index.json', { cache: 'no-store' });
    if (r.ok) index = await r.json();
  } catch { return list; }
  if (!Array.isArray(index)) index = [index];
  let changed = false;
  for (const it of index) {
    let text;
    try { text = await (await fetch('../data/repertoires/' + encodeURIComponent(it.file), { cache: 'no-store' })).text(); } catch { continue; }
    const id = 'ec:' + it.file;
    const cur = list.find(x => x.id === id);
    if (!cur) {
      list.push({ id, name: it.name, color: guessColor(text, it.name), pgn: text, created: Date.parse(it.modified) || Date.now(), source: 'encroissant' });
      changed = true;
    } else if (cur.pgn !== text) {
      cur.pgn = text;
      cur.created = Date.parse(it.modified) || cur.created;
      changed = true;
    }
  }
  if (changed) { reps = list; await persist(); }
  return list;
}

function bestMode() {
  const c = counts();
  return c.due ? 'review' : c.nNew ? 'learn' : 'drill';
}

/** Liste de tous les répertoires avec leur état, pour lancer un entraînement en un clic. */
async function renderRepList() {
  const box = $('rep-list');
  const list = visible();
  if (!list.length) { box.hidden = true; return; }
  await Promise.all(list.map(ensurePgn));
  box.hidden = false;
  const now = Date.now();
  const rows = await Promise.all(list.map(async r => {
    const g = r.id === rep?.id ? G : buildGraph(r);
    const st = r.id === rep?.id ? stats : await getRepStats(r.id);
    let due = 0, nNew = 0;
    for (const k of g.userKeys) { if (!st[k]) nNew++; else if (st[k].due <= now) due++; }
    return { r, due, nNew };
  }));
  box.innerHTML = '<div class="rep-list-title">Mes répertoires</div>' + rows.map(({ r, due, nNew }) => `
    <div class="rep-row ${r.id === rep?.id ? 'cur' : ''}" data-id="${r.id}">
      <img src="../img/pieces/${settings.pieceSet}/${r.color}K.svg" alt="">
      <div class="rep-row-txt"><b>${esc(r.name)}</b><small>${due ? `<span class="due">${due} à réviser</span>` : ''}${due && nNew ? ' · ' : ''}${nNew ? `<span class="new">${nNew} nouveaux</span>` : ''}${!due && !nNew ? 'À jour' : ''}${r.source === 'encroissant' ? ' · En Croissant' : ''}</small></div>
      <button class="btn btn-sm ${due || nNew ? 'btn-primary' : ''}" data-train="${r.id}">${icon('play', 13)}S'entraîner</button>
    </div>`).join('');
  box.querySelectorAll('.rep-row').forEach(row => row.onclick = async e => {
    const id = row.dataset.id;
    if (id !== rep?.id) await selectRep(id);
    if (e.target.closest('[data-train]')) startSession(bestMode());
  });
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

/* ====================================================================== */
/* Répertoire                                                              */
/* ====================================================================== */

function buildGraph(r) {
  const games = parsePgnTree(r.pgn);
  const map = new Map();
  const add = fen => {
    const k = epd(fen);
    if (!map.has(k)) map.set(k, { key: k, fen, turn: fen.split(' ')[1], moves: [] });
    return map.get(k);
  };
  let root = null;
  for (const g of games) {
    const r0 = add(g.startFen);
    if (!root) root = r0;
    if (g.root.comment && !r0.comment) r0.comment = g.root.comment;
    const walk = node => {
      const pos = add(node.fen);
      for (const ch of node.children) {
        let mv = pos.moves.find(m => m.uci === ch.uci);
        if (!mv) {
          mv = { san: ch.san, uci: ch.uci, from: ch.from, to: ch.to, ann: ch.ann || '', comment: ch.comment || '', arrows: ch.arrows || [], marks: ch.marks || [], child: epd(ch.fen) };
          pos.moves.push(mv);
        } else if (!mv.comment && ch.comment) mv.comment = ch.comment;
        add(ch.fen);
        walk(ch);
      }
    };
    walk(g.root);
  }
  const userKeys = [...map.values()].filter(p => p.turn === r.color && p.moves.length).map(p => p.key);
  return { map, root, color: r.color, userKeys };
}

async function selectRep(id) {
  endSession(true);
  rep = visible().find(r => r.id === id) || null;
  const sel = $('rep-select');
  sel.innerHTML = visible().map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('') + '<option value="__import">+ Importer…</option>';
  if (!rep) {
    sel.hidden = !visible().length;
    G = null;
    $('op-empty').hidden = false;
    $('op-overview').hidden = true;
    $('import-card').open = false;
    renderBars();
    renderLibrary();
    return;
  }
  sel.hidden = false;
  sel.value = rep.id;
  sel.onchange = e => {
    if (e.target.value === '__import') { $('import-card').open = true; $('import-card').scrollIntoView({ behavior: 'smooth' }); sel.value = rep.id; return; }
    selectRep(e.target.value);
  };
  localStorageSet('lastRep', rep.id);
  await ensurePgn(rep);
  G = buildGraph(rep);
  stats = await getRepStats(rep.id);
  $('op-empty').hidden = true;
  $('op-overview').hidden = false;
  $('import-card').open = false;
  board.setOrientation(rep.color);
  board.setPosition(G.root.fen, { animate: false });
  board.setArrows([]);
  renderOverview();
  renderBars();
  renderRepList();
  renderLibrary();
}

function counts() {
  const now = Date.now();
  let nNew = 0, due = 0, learned = 0, mastery = 0, nextDue = Infinity;
  for (const k of G.userKeys) {
    const st = stats[k];
    if (!st) { nNew++; continue; }
    learned++;
    if (st.due <= now) due++;
    else nextDue = Math.min(nextDue, st.due);
    mastery += Math.min(st.level + 1, 5) / 5;
  }
  return { nNew, due, learned, total: G.userKeys.length, mastery: G.userKeys.length ? mastery / G.userKeys.length : 0, nextDue };
}

function fmtDelay(ms) {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / DAY)} j`;
}

function renderOverview() {
  if (!rep) return;
  const c = counts();
  const piece = rep.color === 'w' ? 'wK' : 'bK';
  $('rep-color').className = 'rep-color ' + rep.color;
  $('rep-color').innerHTML = `<img src="../img/pieces/${settings.pieceSet}/${piece}.svg" alt="">`;
  $('rep-name').textContent = rep.name;
  $('rep-sub').textContent = `${rep.color === 'w' ? 'Avec les Blancs' : 'Avec les Noirs'} · ${G.map.size - 1} positions · ${rep.source === 'encroissant' ? 'En Croissant, modifié le' : 'importé le'} ${new Date(rep.created).toLocaleDateString('fr-FR')}`;
  $('btn-train-sub').textContent = c.due ? `${c.due} coup${c.due > 1 ? 's' : ''} à réviser` : c.nNew ? `${c.nNew} nouveaux coups à apprendre` : 'Entraînement libre';
  $('st-new').textContent = c.nNew;
  $('st-due').textContent = c.due;
  $('st-learned').textContent = c.learned;
  $('st-total').textContent = c.total;
  const pct = Math.round(c.mastery * 100);
  $('mastery-fill').style.width = pct + '%';
  $('mastery-pct').textContent = pct + ' %';
  $('learn-sub').textContent = c.nNew ? `${c.nNew} coup${c.nNew > 1 ? 's' : ''} à découvrir` : 'Tout est appris';
  $('review-sub').textContent = c.due ? `${c.due} coup${c.due > 1 ? 's' : ''} à revoir` : c.nextDue < Infinity ? `Prochaine révision dans ${fmtDelay(c.nextDue - Date.now())}` : 'Rien à revoir';
  $('mode-learn').disabled = !c.nNew;
  $('mode-review').disabled = !c.due;
  $('op-status').textContent = c.due ? `${c.due} à réviser` : 'Répertoire à jour';
}

function renderBars() {
  const mk = (who, color) => `<span class="avatar"><img src="../img/pieces/${settings.pieceSet}/${color}K.svg" alt="" style="width:28px;height:28px"></span><span class="pname">${who}</span>`;
  if (!rep) { $('op-top').innerHTML = ''; $('op-bottom').innerHTML = ''; return; }
  const opp = rep.color === 'w' ? 'b' : 'w';
  $('op-top').innerHTML = mk('Adversaire', opp);
  $('op-bottom').innerHTML = mk(`Vous <span class="prating">· ${esc(rep.name)}</span>`, rep.color);
}

/* ====================================================================== */
/* Génération des lignes                                                   */
/* ====================================================================== */

function isNew(k) { return !stats[k]; }
function isDue(k) { return !!stats[k] && stats[k].due <= Date.now(); }

function makeNeeds(pred) {
  const memo = new Map();
  const needs = (key, seen = new Set()) => {
    if (!pred) return true;
    if (memo.has(key)) return memo.get(key);
    if (seen.has(key)) return false;
    seen.add(key);
    const p = G.map.get(key);
    let r = false;
    if (p) {
      if (p.turn === G.color && p.moves.length && pred(key)) r = true;
      else r = p.moves.some(m => needs(m.child, seen));
    }
    memo.set(key, r);
    return r;
  };
  return needs;
}

function genLineFrom(startKey, mode) {
  const pred = mode === 'learn' ? isNew : mode === 'review' ? isDue : null;
  const needs = makeNeeds(pred);
  const steps = [];
  const seen = new Set();
  let key = startKey;
  while (steps.length < 160) {
    const p = G.map.get(key);
    if (!p || !p.moves.length || seen.has(key)) break;
    seen.add(key);
    let mv;
    if (p.turn === G.color) {
      mv = (pred && p.moves.find(m => needs(m.child))) || p.moves[0];
      steps.push({ key, fen: p.fen, move: mv, user: true, isNew: isNew(key), isDue: isDue(key) });
    } else {
      let cands = p.moves;
      if (pred) { const w = p.moves.filter(m => needs(m.child)); if (w.length) cands = w; }
      mv = cands[Math.floor(Math.random() * cands.length)];
      steps.push({ key, fen: p.fen, move: mv, user: false });
    }
    key = mv.child;
  }
  return steps;
}

/* ====================================================================== */
/* Séances                                                                 */
/* ====================================================================== */

function showSessionUi(on) {
  $('op-overview').hidden = on;
  $('op-session').hidden = !on;
  $('op-foot').hidden = !on;
  $('import-card').hidden = on;
  $('library').hidden = on || !library.length;
}

function startSession(mode) {
  if (!G) return;
  browse = null;
  sess = { mode, lineNo: 0, ok: 0, bad: 0 };
  showSessionUi(true);
  $('browse-moves').hidden = true;
  for (const id of ['btn-hint', 'btn-show', 'btn-next-line']) $(id).hidden = false;
  $('btn-back').hidden = true;
  $('session-mode').textContent = MODE_LABEL[mode];
  nextLine();
}

function endSession(silent) {
  token++;
  sess = null;
  browse = null;
  showSessionUi(false);
  board.setArrows([]);
  board.setBadge(null);
  if (!silent && G) {
    board.setPosition(G.root.fen, { animate: false });
    renderOverview();
    renderRepList();
  }
}

async function nextLine() {
  const steps = genLineFrom(G.root.key, sess.mode);
  if (!steps.some(s => s.user) || (sess.mode === 'learn' && !steps.some(s => s.user && s.isNew)) || (sess.mode === 'review' && !steps.some(s => s.user && s.isDue))) {
    setStatus('done', 'Séance terminée', sess.mode === 'learn' ? 'Tous les coups de ce répertoire sont appris. Revenez pour les révisions !' : sess.mode === 'review' ? 'Plus rien à réviser pour le moment. Bravo !' : 'Ce répertoire ne contient aucun coup à jouer pour votre camp.');
    sess.done = true;
    $('btn-next-line').hidden = true;
    renderOverview();
    return;
  }
  Object.assign(sess, { steps, idx: 0, done: false, waiting: false, results: [] });
  sess.lineNo++;
  $('btn-next-line').hidden = false;
  $('btn-next-line').classList.remove('btn-primary');
  $('comment-box').hidden = true;
  board.setOrientation(G.color);
  board.setPosition(G.root.fen, { animate: false });
  board.setArrows([]);
  board.setBadge(null);
  renderChips();
  updateCount();
  await runAuto(++token);
}

async function runAuto(t) {
  const s = sess;
  while (s.idx < s.steps.length && !s.steps[s.idx].user) {
    await sleep(s.idx === 0 ? 350 : 600);
    if (t !== token) return;
    const st = s.steps[s.idx];
    const after = playOnBoard(st.fen, st.move);
    s.results[s.idx] = 'opp';
    showComment(st, st.move);
    s.idx++;
    renderChips();
    void after;
  }
  if (t !== token) return;
  if (s.idx >= s.steps.length) return lineDone();
  const st = s.steps[s.idx];
  s.waiting = true;
  if (s.mode === 'learn' && st.isNew) {
    st.demo = true;
    setStatus('new', 'Nouveau coup', `Votre répertoire joue <b>${esc(st.move.san)}</b>. Jouez-le sur l'échiquier.`);
    board.setArrows([{ from: st.move.from, to: st.move.to, color: 'rgba(93,154,217,.9)' }, ...(st.move.arrows || [])]);
    showComment(st, st.move, true);
  } else {
    setStatus('', 'À vous de jouer', st.isDue ? 'Quel coup joue votre répertoire ici ? <span class="muted">(à réviser)</span>' : 'Quel coup joue votre répertoire ici ?');
    board.setArrows([]);
  }
  renderChips();
}

function playOnBoard(fen, mv) {
  const c = new Chess(fen);
  const m = c.move({ from: mv.uci.slice(0, 2), to: mv.uci.slice(2, 4), promotion: mv.uci[4] });
  board.setPosition(c.fen(), { lastMove: [m.from, m.to], check: c.inCheck() ? kingSq(c) : null });
  playForMove(m, c.inCheck());
  for (const mk of mv.marks || []) board.userMarks.add(mk.sq);
  board.setArrows(mv.arrows || []);
  return c.fen();
}

function kingSq(c) {
  for (const row of c.board()) for (const x of row) if (x && x.type === 'k' && x.color === c.turn()) return x.square;
  return null;
}

function getDests(sq) {
  const fen = currentFen();
  const c = new Chess(fen);
  if (browse) {
    const p = G?.map.get(epd(fen));
    if (!p) return [];
    return c.moves({ square: sq, verbose: true }).filter(m => p.moves.some(x => x.uci === m.from + m.to + (m.promotion || ''))).map(m => ({ to: m.to, promotion: m.promotion }));
  }
  if (!sess || !sess.waiting || c.turn() !== G.color) return [];
  return c.moves({ square: sq, verbose: true }).map(m => ({ to: m.to, promotion: m.promotion }));
}

function currentFen() { return board.fen || G?.root.fen || new Chess().fen(); }

async function onMove({ from, to, promotion }) {
  if (browse) {
    const p = G.map.get(epd(currentFen()));
    const mv = p?.moves.find(x => x.from === from && x.to === to);
    if (mv) browseGo(mv);
    return;
  }
  const s = sess;
  if (!s || !s.waiting) return;
  const st = s.steps[s.idx];
  const c = new Chess(st.fen);
  let m;
  try { m = c.move({ from, to, promotion: promotion || 'q' }); } catch { m = null; }
  if (!m) return;
  const uci = m.from + m.to + (m.promotion || '');
  const p = G.map.get(st.key);
  const mv = p.moves.find(x => x.uci === uci);
  if (!mv) {
    // mauvais coup
    s.waiting = false;
    board.setPosition(c.fen(), { lastMove: [m.from, m.to] });
    board.setBadge(m.to, 'mistake');
    play('error');
    if (!st.failed) { st.failed = true; s.bad++; grade(st, 'bad'); }
    s.results[s.idx] = 'bad';
    const others = p.moves.length > 1 ? ` (ou ${p.moves.slice(1).map(x => esc(x.san)).join(', ')})` : '';
    setStatus('bad', `${esc(m.san)} n'est pas dans votre répertoire`, `Le coup attendu était <b>${esc(st.move.san)}</b>${others}. Rejouez-le.`);
    renderChips();
    const t = token;
    await sleep(700);
    if (t !== token) return;
    board.setBadge(null);
    board.setPosition(st.fen, { animate: true, lastMove: s.idx > 0 ? lastMoveOf(s.steps[s.idx - 1]) : null });
    board.setArrows([{ from: st.move.from, to: st.move.to, color: 'rgba(129,182,76,.85)' }]);
    s.waiting = true;
    return;
  }
  // bon coup (éventuellement une autre branche du répertoire)
  if (mv !== st.move) {
    st.move = mv;
    s.steps.splice(s.idx + 1, Infinity, ...genLineFrom(mv.child, s.mode));
  }
  s.waiting = false;
  const result = st.failed ? 'bad' : st.hinted ? 'hint' : st.demo ? 'new' : 'ok';
  if (result !== 'bad') grade(st, result);
  if (result === 'ok' || result === 'new') s.ok++;
  s.results[s.idx] = result === 'hint' ? 'bad' : result;
  board.setArrows([]);
  playOnBoard(st.fen, mv);
  board.setBadge(mv.to, result === 'ok' ? 'best' : result === 'new' ? 'book' : 'good');
  setStatus(result === 'bad' || result === 'hint' ? '' : 'ok',
    result === 'new' ? 'Bien joué' : result === 'ok' ? pickOk() : 'C\'est ça',
    result === 'new' ? 'Coup ajouté à vos révisions.' : `${esc(mv.san)}${esc(mv.ann)} est bien votre coup de répertoire.`);
  showComment(st, mv);
  s.idx++;
  renderChips();
  updateCount();
  const t = token;
  await sleep(550);
  if (t !== token) return;
  board.setBadge(null);
  runAuto(t);
}

const OK_WORDS = ['Correct !', 'Exact !', 'Parfait !', 'Bien vu !', 'Très bien !', 'Oui !'];
function pickOk() { return OK_WORDS[Math.floor(Math.random() * OK_WORDS.length)]; }

function lastMoveOf(step) { return step ? [step.move.from, step.move.to] : null; }

function grade(st, result) {
  const now = Date.now();
  const cur = stats[st.key];
  if (result === 'bad') {
    stats[st.key] = { level: 0, due: now + 10 * MIN, ok: cur?.ok || 0, ko: (cur?.ko || 0) + 1, last: now };
  } else if (result === 'new') {
    stats[st.key] = { level: 0, due: now + LEVELS[0], ok: 1, ko: 0, last: now };
  } else if (result === 'hint') {
    stats[st.key] = { level: cur ? cur.level : 0, due: now + LEVELS[0], ok: cur?.ok || 0, ko: cur?.ko || 0, last: now };
  } else {
    if (!cur) stats[st.key] = { level: 1, due: now + LEVELS[1], ok: 1, ko: 0, last: now };
    else if (cur.due <= now) {
      const level = Math.min(LEVELS.length - 1, cur.level + 1);
      stats[st.key] = { ...cur, level, due: now + LEVELS[level], ok: cur.ok + 1, last: now };
    } else stats[st.key] = { ...cur, ok: cur.ok + 1, last: now };
  }
  saveRepStats(rep.id, stats);
}

function lineDone() {
  const s = sess;
  s.done = true;
  const users = s.steps.map((st, i) => st.user ? s.results[i] : null).filter(Boolean);
  const good = users.filter(r => r === 'ok' || r === 'new').length;
  const perfect = good === users.length;
  play(perfect ? 'success' : 'notify');
  setStatus('done', perfect ? 'Ligne maîtrisée' : 'Ligne terminée', `${good}/${users.length} coup${users.length > 1 ? 's' : ''} sans erreur. Appuyez sur Entrée pour la ligne suivante.`);
  $('btn-next-line').classList.add('btn-primary');
  renderOverview();
  updateCount();
}

function hint() {
  const s = sess;
  if (!s || !s.waiting) return;
  const st = s.steps[s.idx];
  st.hinted = true;
  board.userMarks.add(st.move.from);
  board.drawArrows();
  setStatus('', 'Indice', 'Cette pièce doit bouger.');
}

function showAnswer() {
  const s = sess;
  if (!s || !s.waiting) return;
  const st = s.steps[s.idx];
  if (!st.failed) { st.failed = true; s.bad++; grade(st, 'bad'); }
  board.setArrows([{ from: st.move.from, to: st.move.to, color: 'rgba(129,182,76,.85)' }]);
  setStatus('bad', 'Solution', `Le coup du répertoire est <b>${esc(st.move.san)}</b>. Jouez-le pour continuer.`);
  showComment(st, st.move, true);
}

function setStatus(kind, title, html) {
  $('op-statusbox').className = 'op-status ' + (kind || '');
  $('status-title').innerHTML = title;
  $('status-text').innerHTML = html;
}

function moveLabel(fen, san) {
  const [, turn, , , , num] = fen.split(' ');
  return turn === 'w' ? `${num}. ${san}` : `${num}… ${san}`;
}

function showComment(st, mv, before = false) {
  const box = $('comment-box');
  if (!mv.comment) { if (!before) box.hidden = true; return; }
  box.hidden = false;
  $('comment-move').textContent = moveLabel(st.fen, mv.san + (mv.ann || ''));
  $('comment-text').textContent = mv.comment;
}

function renderChips() {
  const s = sess;
  const el = $('line-chips');
  if (!s?.steps) { el.innerHTML = ''; return; }
  el.innerHTML = s.steps.map((st, i) => {
    const r = s.results[i];
    const cls = ['chip', st.user ? 'user' : 'opp', r === 'ok' ? 'ok' : r === 'bad' ? 'bad' : r === 'new' ? 'new' : '', i === s.idx && !s.done ? 'cur' : '', i > s.idx || (i === s.idx && !r) ? 'pending' : ''].join(' ');
    const label = i < s.idx || r ? moveLabel(st.fen, st.move.san + (st.move.ann || '')) : (st.user ? moveLabel(st.fen, '?') : moveLabel(st.fen, '…'));
    return `<span class="${cls}">${esc(label)}</span>`;
  }).join('');
}

function updateCount() {
  if (!sess) return;
  $('session-count').textContent = `Ligne ${sess.lineNo} · ${sess.ok} juste${sess.ok > 1 ? 's' : ''} · ${sess.bad} erreur${sess.bad > 1 ? 's' : ''}`;
}

/* ====================================================================== */
/* Parcourir                                                               */
/* ====================================================================== */

function startBrowse() {
  if (!G) return;
  token++;
  sess = null;
  browse = { key: G.root.key, history: [] };
  showSessionUi(true);
  $('session-mode').textContent = MODE_LABEL.browse;
  $('session-count').textContent = '';
  $('line-chips').innerHTML = '';
  for (const id of ['btn-hint', 'btn-show', 'btn-next-line']) $(id).hidden = true;
  $('btn-back').hidden = false;
  board.setOrientation(G.color);
  board.setPosition(G.root.fen, { animate: false });
  renderBrowse();
}

function browseGo(mv) {
  const p = G.map.get(browse.key);
  browse.history.push({ key: browse.key, mv });
  browse.key = mv.child;
  playOnBoard(p.fen, mv);
  renderBrowse(mv, p.fen);
}

function browseBack() {
  if (!browse || !browse.history.length) return;
  const h = browse.history.pop();
  browse.key = h.key;
  const p = G.map.get(h.key);
  const prev = browse.history[browse.history.length - 1];
  board.setPosition(p.fen, { lastMove: prev ? [prev.mv.from, prev.mv.to] : null });
  board.setArrows([]);
  renderBrowse(prev?.mv, prev ? G.map.get(prev.key).fen : null);
}

function renderBrowse(lastMv, lastFen) {
  const p = G.map.get(browse.key);
  const path = browse.history.map(h => moveLabel(G.map.get(h.key).fen, h.mv.san + (h.mv.ann || ''))).join(' ');
  const userTurn = p && p.turn === G.color;
  setStatus(userTurn ? 'new' : '', browse.history.length ? 'Position du répertoire' : 'Position de départ',
    `<div class="bm-path">${esc(path) || 'Cliquez sur un coup ou jouez-le sur l\'échiquier.'}</div>${p && p.moves.length ? (userTurn ? 'Votre coup :' : 'Réponses adverses prévues :') : 'Fin de la ligne.'}`);
  if (lastMv && lastMv.comment) showComment({ fen: lastFen }, lastMv); else $('comment-box').hidden = true;
  const box = $('browse-moves');
  box.hidden = false;
  box.innerHTML = '';
  for (const mv of p?.moves || []) {
    const d = document.createElement('div');
    d.className = 'bm' + (userTurn ? ' user' : '');
    d.innerHTML = `<span class="bm-san">${esc(moveLabel(p.fen, mv.san + (mv.ann || '')))}</span><span class="bm-com">${esc(mv.comment || '')}</span>`;
    d.onclick = () => browseGo(mv);
    box.appendChild(d);
  }
}

/* ====================================================================== */
/* Import                                                                  */
/* ====================================================================== */

function setupImport() {
  const input = $('file-input');
  const drop = $('file-drop');
  input.onchange = () => importFiles([...input.files]);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('drag');
    importFiles([...e.dataTransfer.files]);
  });
  $('btn-import').onclick = () => {
    const txt = $('pgn-paste').value.trim();
    if (txt) importTexts([{ name: 'Répertoire', text: txt }]);
    else input.click();
  };
}

async function importFiles(files) {
  const items = [];
  for (const f of files) items.push({ name: f.name.replace(/\.(pgn|txt)$/i, ''), text: await f.text() });
  importTexts(items);
}

async function importTexts(items) {
  const colorChoice = $('import-color').value;
  let added = 0, lastId = null;
  const msgs = [];
  for (const it of items) {
    let games;
    try { games = parsePgnTree(it.text); } catch (e) { msgs.push(`${it.name} : illisible`); continue; }
    let n = 0;
    const count = node => { for (const c of node.children) { n++; count(c); } };
    games.forEach(g => count(g.root));
    if (!n) { msgs.push(`${it.name} : aucun coup trouvé`); continue; }
    const h = games[0].headers;
    let color = colorChoice;
    if (color === 'auto') color = /^black$/i.test(h.Orientation || '') ? 'b' : /^white$/i.test(h.Orientation || '') ? 'w' : /black|noirs?/i.test(it.name) ? 'b' : 'w';
    const name = (h.Event && h.Event !== '?' ? h.Event : it.name).slice(0, 80);
    const existing = reps.find(r => r.name === name && r.color === color);
    if (existing) {
      existing.pgn = it.text;
      existing.moves = n;
      lastId = existing.id;
    } else {
      const r = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, color, pgn: it.text, moves: n, created: Date.now() };
      reps.push(r);
      lastId = r.id;
    }
    added++;
  }
  await persist();
  $('pgn-paste').value = '';
  $('file-input').value = '';
  if (msgs.length) alert(msgs.join('\n'));
  if (added) selectRep(lastId);
}

init();
