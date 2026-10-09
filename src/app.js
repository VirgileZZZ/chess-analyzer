// Page principale : chargement d'une partie, analyse Stockfish, bilan façon chess.com.
import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { Engine, EnginePool, LiveAnalyzer } from './engine.js';
import { loadSettings, onSettingsChanged, ENGINES, usableEngine } from './settings.js';
import { renderSettings } from './settings-ui.js';
import { CLASSES, SUMMARY_ORDER, classIcon } from './classes.js';
import {
  buildPositions, evaluatePositions, classifyGame, explain, extractPuzzles,
  scoreToCp, winPct, moverWin, formatScore, pvToSan,
} from './analysis.js';
import { fetchChessComGame, parsePgn, fetchRecentGames, avatarBlobUrl, parseGameUrl } from './chesscom.js';
import { cacheKey, getCachedAnalysis, saveAnalysis, expandEvals, listAnalyses, deleteAnalysis, addPuzzles } from './storage.js';
import { EvalGraph } from './graph.js';
import { buildNarrative } from './narrative.js';
import { explainRich } from './explain.js';
import { configureSound, play, playForMove } from './sound.js';
import { icon, hydrateIcons, timeClassIcon } from './icons.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLOR_NAME = { w: 'Blancs', b: 'Noirs' };
const GOOD_CLASSES = new Set(['best', 'brilliant', 'great', 'book', 'forced']);
const ERROR_CLASSES = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

const S = {
  settings: null,
  game: null,
  positions: null,
  evals: null,
  result: null,
  cur: 0,
  view: null,
  variation: null,
  retry: null,
  engine: null,
  live: null,
  liveOn: true,
  liveInfo: null,
  pool: null,
  avatars: { w: null, b: null },
  orientation: 'w',
  key: null,
};

let board, summaryGraph, reviewGraph, progressGraph;

/* ====================================================================== */
/* Initialisation                                                          */
/* ====================================================================== */

async function init() {
  hydrateIcons();
  S.settings = await loadSettings();
  S.liveOn = S.settings.liveEngine;
  configureSound(S.settings);
  $('live-toggle').checked = S.liveOn;

  board = new Board($('board'), {
    theme: S.settings.boardTheme,
    pieceSet: S.settings.pieceSet,
    coords: S.settings.showCoords,
    animMs: S.settings.animationMs,
    autoQueen: S.settings.autoQueen,
    getDests,
    onMove: onUserMove,
  });
  board.setPosition(new Chess().fen(), { animate: false });

  const tooltip = ply => {
    if (!S.positions || ply === 0) return 'Début';
    const a = S.result?.moves[ply];
    const m = S.positions[ply]?.move;
    if (!m) return '';
    const num = Math.ceil(ply / 2) + (m.color === 'w' ? '. ' : '… ');
    const ev = S.evals?.[ply] ? formatScore(S.evals[ply].lines[0].score) : '';
    return `${num}${m.san}  ${ev}${a ? '  · ' + CLASSES[a.cls].label : ''}`;
  };
  summaryGraph = new EvalGraph($('summary-graph'), { onSelect: ply => { setView('review'); goTo(ply); }, tooltip });
  reviewGraph = new EvalGraph($('review-graph'), { onSelect: ply => goTo(ply), tooltip });
  progressGraph = new EvalGraph($('progress-graph'), {});

  bindUi();
  applyVisualSettings();
  onSettingsChanged(s => { S.settings = s; });

  const q = new URLSearchParams(location.search);
  try {
    if (q.get('id')) await loadChessCom(q.get('id'), q.get('gtype') || 'live');
    else if (q.get('cache')) await loadCached(q.get('cache'));
    else if (q.get('explore')) startGame(parsePgn(q.get('fen') || new Chess().fen()));
    else showLoadView();
  } catch (e) {
    console.error(e);
    toast('Erreur : ' + e.message);
    showLoadView();
  }
}

function bindUi() {
  $('nav-first').onclick = () => navFirst();
  $('nav-prev').onclick = () => navPrev();
  $('nav-next').onclick = () => navNext();
  $('nav-last').onclick = () => navLast();
  $('btn-flip').onclick = () => flip();
  $('btn-settings').onclick = openSettings;
  $('btn-story').onclick = () => openStory('moments');
  $('btn-story-foot').onclick = () => openStory();
  $('story-close').onclick = closeStory;
  $('story-modal').addEventListener('click', e => { if (e.target.id === 'story-modal') closeStory(); });
  $('btn-settings-top').onclick = openSettings;
  $('settings-close').onclick = () => { $('settings-modal').hidden = true; };
  $('settings-modal').addEventListener('click', e => { if (e.target.id === 'settings-modal') $('settings-modal').hidden = true; });
  $('btn-new').onclick = () => { stopLive(); showLoadView(); };
  $('btn-summary').onclick = () => { if (S.result) setView(S.view === 'summary' ? 'review' : 'summary'); };
  $('btn-start-review').onclick = () => { setView('review'); goTo(0); };
  $('btn-reanalyze').onclick = () => startGame(S.game, { force: true });
  $('btn-copy-pgn').onclick = copyPgn;
  $('btn-cancel').onclick = cancelAnalysis;
  $('btn-load-pgn').onclick = loadFromInput;
  $('btn-explore').onclick = () => startGame(parsePgn(new Chess().fen()));
  $('btn-load-user').onclick = loadUserGames;
  $('username-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadUserGames(); });
  $('live-toggle').onchange = e => {
    S.liveOn = e.target.checked;
    if (S.liveOn) requestLive(); else { stopLive(); renderEngineLines(); }
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', e => {
    const r = e.target.closest('.mref');
    if (!r || !S.positions) return;
    e.stopPropagation();
    closeStory();
    const ply = +r.dataset.ply;
    setView('review');
    if (r.dataset.alt && S.result?.moves[ply]) { goTo(ply); showBestLine(S.result.moves[ply]); }
    else goTo(ply);
  });
  $('board').addEventListener('wheel', e => {
    if (S.view !== 'review') return;
    e.preventDefault();
    e.deltaY > 0 ? navNext() : navPrev();
  }, { passive: false });
}

function onKey(e) {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if (!$('settings-modal').hidden) { if (e.key === 'Escape') $('settings-modal').hidden = true; return; }
  if (!$('story-modal').hidden) { if (e.key === 'Escape') closeStory(); return; }
  if ((e.key === 'r' || e.key === 'R') && S.narrative && (S.view === 'review' || S.view === 'summary')) { openStory(); e.preventDefault(); return; }
  if (S.view !== 'review' && S.view !== 'summary') return;
  const k = e.key;
  if (k === 'ArrowLeft') navPrev();
  else if (k === 'ArrowRight') navNext();
  else if (k === 'ArrowUp' || k === 'Home') navFirst();
  else if (k === 'ArrowDown' || k === 'End') navLast();
  else if (k === 'f' || k === 'F') flip();
  else if (k === 'Escape') { if (S.retry) exitRetry(); else if (S.variation) closeVariation(); }
  else if (k === ' ' && S.view === 'summary') { setView('review'); }
  else return;
  e.preventDefault();
}

function setView(v) {
  S.view = v;
  for (const id of ['load', 'progress', 'summary', 'review']) $('view-' + id).hidden = id !== v;
  $('panel-foot').hidden = !(v === 'summary' || v === 'review');
  $('btn-summary').hidden = !S.result;
  $('btn-summary').innerHTML = v === 'summary' ? icon('play', 16) + 'Bilan' : icon('list', 16) + 'Résumé';
  $('panel-title').textContent = { load: 'Analyser une partie', progress: 'Analyse en cours', summary: 'Bilan de la partie', review: S.result ? 'Bilan de la partie' : 'Analyse' }[v];
  if (v === 'review') { display({ animate: false }); scrollToCurrent(); }
  else if (v !== 'review') stopLive();
  if (v === 'summary') display({ animate: false });
}

function setStatus(state, label) {
  const el = $('engine-status');
  el.className = 'engine-status ' + (state || '');
  el.querySelector('.label').textContent = label;
}

function toast(msg, ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ====================================================================== */
/* Chargement                                                              */
/* ====================================================================== */

async function showLoadView() {
  setView('load');
  $('username-input').value = S.settings.username || '';
  renderRecent();
  if (S.settings.username && !$('game-list').children.length) loadUserGames();
}

async function renderRecent() {
  const list = await listAnalyses();
  const el = $('recent-list');
  el.innerHTML = list.length ? '' : '<div class="empty">Aucune analyse enregistrée.</div>';
  for (const it of list.slice(0, 25)) {
    const row = document.createElement('div');
    row.className = 'game-item';
    const me = (S.settings.username || '').toLowerCase();
    const res = resultClass(it.result, it.white?.name, it.black?.name, me);
    row.innerHTML = `<span class="tc">${icon('chart', 18)}</span>
      <span class="names"><span>${esc(it.white?.name)} <span class="r">(${it.white?.rating ?? '?'})</span></span><span>${esc(it.black?.name)} <span class="r">(${it.black?.rating ?? '?'})</span></span></span>
      <span class="res ${res}">${esc(it.result || '*')}</span>
      <span class="meta"><span>${it.accW != null ? `Précision ${it.accW.toFixed(1)} / ${it.accB.toFixed(1)}` : ''}</span><span>${new Date(it.savedAt).toLocaleDateString('fr-FR')} <button class="del" title="Supprimer">🗑</button></span></span>`;
    row.onclick = e => {
      if (e.target.closest('.del')) {
        e.stopPropagation();
        deleteAnalysis(it.key).then(renderRecent);
        return;
      }
      loadCached(it.key);
    };
    el.appendChild(row);
  }
}

function resultClass(result, w, b, me) {
  if (result === '1/2-1/2') return 'draw';
  if (!me) return result === '1-0' ? 'win' : result === '0-1' ? 'loss' : 'draw';
  const myColor = (w || '').toLowerCase() === me ? 'w' : (b || '').toLowerCase() === me ? 'b' : null;
  if (!myColor) return 'draw';
  const won = (result === '1-0' && myColor === 'w') || (result === '0-1' && myColor === 'b');
  return won ? 'win' : 'loss';
}

async function loadUserGames() {
  const u = $('username-input').value.trim();
  if (!u) return;
  const el = $('game-list');
  el.innerHTML = '<div class="empty">Chargement…</div>';
  try {
    const games = await fetchRecentGames(u, 40);
    el.innerHTML = games.length ? '' : '<div class="empty">Aucune partie trouvée.</div>';
    for (const g of games) {
      const me = u.toLowerCase();
      const myColor = g.white.username.toLowerCase() === me ? 'w' : 'b';
      const my = myColor === 'w' ? g.white : g.black;
      const res = my.result === 'win' ? 'win' : ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(my.result) ? 'draw' : 'loss';
      const row = document.createElement('div');
      row.className = 'game-item';
      const acc = g.accuracies ? `chess.com : ${g.accuracies.white?.toFixed?.(1) ?? '?'} / ${g.accuracies.black?.toFixed?.(1) ?? '?'}` : '';
      row.innerHTML = `<span class="tc" title="${esc(g.timeClass)}">${timeClassIcon(g.timeClass)}</span>
        <span class="names"><span><i class="sqc w"></i>${esc(g.white.username)} <span class="r">(${g.white.rating})</span></span><span><i class="sqc b"></i>${esc(g.black.username)} <span class="r">(${g.black.rating})</span></span></span>
        <span class="res ${res}">${res === 'win' ? 'Victoire' : res === 'draw' ? 'Nulle' : 'Défaite'}</span>
        <span class="meta"><span>${acc}</span><span>${new Date(g.end).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span></span>`;
      row.onclick = async () => {
        if (g.id) {
          try { await loadChessCom(g.id, g.gtype); return; } catch (e) { console.warn(e); }
        }
        startGame(parsePgn(g.pgn));
      };
      el.appendChild(row);
    }
  } catch (e) {
    el.innerHTML = `<div class="empty">Impossible de charger les parties (${esc(e.message)}).</div>`;
  }
}

async function loadFromInput() {
  const txt = $('pgn-input').value.trim();
  if (!txt) return;
  const link = parseGameUrl(txt);
  try {
    if (link && /^https?:/.test(txt) && !txt.includes('\n')) await loadChessCom(link.id, link.gtype);
    else startGame(parsePgn(txt));
  } catch (e) {
    toast('PGN / FEN invalide : ' + e.message);
  }
}

async function loadChessCom(id, gtype) {
  setView('progress');
  $('progress-title').textContent = 'Chargement de la partie…';
  $('progress-sub').textContent = 'chess.com #' + id;
  $('progress-fill').style.width = '0%';
  const game = await fetchChessComGame(id, gtype);
  history.replaceState(null, '', `?id=${game.id}&gtype=${game.gtype}`);
  await startGame(game);
}

async function loadCached(key) {
  const c = await getCachedAnalysis(key);
  if (!c) { toast('Analyse introuvable'); return showLoadView(); }
  history.replaceState(null, '', c.game.id ? `?id=${c.game.id}&gtype=${c.game.gtype || 'live'}` : `?cache=${encodeURIComponent(key)}`);
  await startGame(c.game, { evals: expandEvals(c.evals), key });
}

/* ====================================================================== */
/* Analyse                                                                 */
/* ====================================================================== */

async function startGame(game, { force = false, evals = null, key = null } = {}) {
  stopLive();
  S.game = game;
  S.positions = buildPositions(game.startFen, game.moves);
  S.result = null;
  S.evals = null;
  S.variation = null;
  S.retry = null;
  S.cur = S.positions.length - 1;
  const me = (S.settings.username || '').toLowerCase();
  S.orientation = S.settings.autoFlip && me && (game.black?.name || '').toLowerCase() === me ? 'b' : 'w';
  board.setOrientation(S.orientation);
  loadAvatars();
  renderPlayers();
  $('btn-open-cc').hidden = !game.url;
  if (game.url) $('btn-open-cc').href = game.url;
  document.title = `${game.white?.name || 'Blancs'} vs ${game.black?.name || 'Noirs'} — Bilan`;
  display({ animate: false });

  if (S.positions.length === 1) {
    // Plateau libre / FEN : pas de partie à analyser.
    S.cur = 0;
    setView('review');
    renderMoves();
    display({ animate: false });
    return;
  }

  S.key = key || cacheKey(game, S.settings);
  if (!evals && !force && S.settings.cacheAnalyses) {
    const c = await getCachedAnalysis(S.key);
    if (c) evals = expandEvals(c.evals);
  }
  let fresh = false;
  if (!evals || evals.length !== S.positions.length) {
    evals = await runAnalysis();
    if (!evals) return;
    fresh = true;
  }
  S.evals = evals;
  reclassify();
  if (fresh) {
    play('end');
    const sum = S.result.summary.players;
    if (S.settings.cacheAnalyses) saveAnalysis(S.key, game, evals, { accW: sum.w.accuracy, accB: sum.b.accuracy }).catch(console.warn);
    if (S.settings.autoPuzzles) {
      const pz = extractPuzzles({ ...game, gtype: game.gtype }, S.positions, evals, S.result.moves, S.settings);
      addPuzzles(pz).then(n => { if (n) toast(`${n} nouveau${n > 1 ? 'x' : ''} puzzle${n > 1 ? 's' : ''} créé${n > 1 ? 's' : ''} à partir de cette partie`); });
    }
  }
  S.cur = S.positions.length - 1;
  setView('summary');
}

async function runAnalysis() {
  const s = S.settings;
  setView('progress');
  const flavor = s.engine === 'lite-mt' ? 'lite-single' : await usableEngine(s.engine);
  const workers = flavor === 'full-single' ? Math.min(2, s.workers) : s.workers;
  const total = S.positions.length;
  $('progress-title').textContent = 'Chargement de Stockfish…';
  $('progress-sub').textContent = `${ENGINES[flavor].name} · ${workers} moteur${workers > 1 ? 's' : ''}`;
  $('progress-fill').style.width = '0%';
  setStatus('busy', 'Analyse…');
  const pool = new EnginePool(workers, flavor, { hash: s.hash });
  S.pool = pool;
  const t0 = performance.now();
  try {
    await pool.init();
    if (pool.cancelled) return null;
    $('progress-title').textContent = 'Analyse en cours…';
    const wins = new Array(total).fill(null);
    const evals = await evaluatePositions(S.positions, pool, {
      depth: s.searchMode === 'depth' ? s.depth : 0,
      movetime: s.searchMode === 'time' ? s.movetime : 0,
      multipv: 2,
      onProgress: (done, tot, ev) => {
        $('progress-fill').style.width = (done / tot * 100).toFixed(1) + '%';
        const secs = (performance.now() - t0) / 1000;
        const eta = done ? Math.round(secs / done * (tot - done)) : 0;
        $('progress-sub').textContent = `Position ${done}/${tot} · ${s.searchMode === 'depth' ? 'profondeur ' + s.depth : s.movetime + ' ms/position'} · ${workers} moteur${workers > 1 ? 's' : ''}${eta ? ` · ~${eta}s restantes` : ''}`;
        ev.forEach((e, i) => { if (e) wins[i] = winPct(scoreToCp(e.lines[0].score)); });
        progressGraph.set({ wins: wins.map(w => w ?? 50), classes: [], cur: null });
      },
    });
    if (pool.cancelled) return null;
    setStatus('ready', `Stockfish 19 · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    return evals;
  } catch (e) {
    console.error(e);
    toast('Erreur du moteur : ' + e.message);
    setStatus('', 'Erreur moteur');
    showLoadView();
    return null;
  } finally {
    pool.terminate();
    if (S.pool === pool) S.pool = null;
  }
}

function cancelAnalysis() {
  if (S.pool) S.pool.cancel();
  setStatus('', 'Stockfish 19');
  showLoadView();
}

function reclassify() {
  S.result = classifyGame(S.positions, S.evals, S.settings);
  try {
    S.narrative = buildNarrative({ game: S.game, positions: S.positions, evals: S.evals, result: S.result, settings: S.settings });
  } catch (e) {
    console.error('narrative', e);
    S.narrative = null;
  }
  renderSummary();
  renderMoves();
  updateGraphs();
}

/* ====================================================================== */
/* Résumé                                                                  */
/* ====================================================================== */

function avatarHtml(color) {
  const p = color === 'w' ? S.game.white : S.game.black;
  if (S.avatars[color]) return `<span class="avatar"><img src="${S.avatars[color]}" alt=""></span>`;
  return `<span class="avatar">${esc((p?.name || '?')[0].toUpperCase())}</span>`;
}

async function loadAvatars() {
  S.avatars = { w: null, b: null };
  const g = S.game;
  const [w, b] = await Promise.all([avatarBlobUrl(g.white?.avatar), avatarBlobUrl(g.black?.avatar)]);
  if (g !== S.game) return;
  S.avatars = { w, b };
  renderPlayers();
  if (S.result) renderSummary();
}

function renderSummary() {
  const { players, opening } = S.result.summary;
  const g = S.game;
  const W = players.w, B = players.b;
  const fmt = a => a == null ? '—' : a.toFixed(1);

  $('summary-coach').innerHTML = (S.narrative?.headline ? `<div class="coach-headline">${esc(S.narrative.headline)}</div>` : '') + coachSummary(players);
  renderStory();

  $('sum-players').innerHTML = `
    <span></span>
    <div class="pcol">${avatarHtml('w')}<span>${esc(g.white?.name)}</span></div>
    <div class="pcol">${avatarHtml('b')}<span>${esc(g.black?.name)}</span></div>
    <span class="lbl">Précision</span>
    <span class="acc-box w">${fmt(W.accuracy)}</span>
    <span class="acc-box b">${fmt(B.accuracy)}</span>`;

  const table = $('sum-table');
  table.innerHTML = '';
  for (const k of SUMMARY_ORDER) {
    const c = CLASSES[k];
    const nw = W.counts[k] || 0, nb = B.counts[k] || 0;
    const row = document.createElement('div');
    row.className = 'sum-row clickable';
    row.innerHTML = `<span class="name">${c.label}</span>
      <span class="cnt ${nw ? '' : 'zero'}" data-c="w" style="color:${c.color}">${nw}${classIcon(k, 24)}</span>
      <span class="cnt ${nb ? '' : 'zero'}" data-c="b" style="color:${c.color}">${classIcon(k, 24)}${nb}</span>`;
    row.querySelectorAll('.cnt').forEach(el => el.onclick = () => {
      const color = el.dataset.c;
      const a = S.result.moves.find(m => m && m.cls === k && m.color === color);
      if (a) { setView('review'); goTo(a.ply); }
    });
    table.appendChild(row);
  }

  const phaseRow = (label, ph) => {
    const iw = W.phaseIcons?.[ph], ib = B.phaseIcons?.[ph];
    return `<div class="sum-row"><span class="name">${label}</span>
      <span class="cnt">${iw ? classIcon(iw, 26) : '<span style="opacity:.35">—</span>'}</span>
      <span class="cnt">${ib ? classIcon(ib, 26) : '<span style="opacity:.35">—</span>'}</span></div>`;
  };
  $('sum-extra').innerHTML = `
    <div class="sum-row"><span class="name">Performance estimée</span>
      <span class="cnt"><span class="rating-box">${W.elo ?? '—'}</span></span>
      <span class="cnt"><span class="rating-box">${B.elo ?? '—'}</span></span></div>
    ${phaseRow('Ouverture', 'opening')}
    ${phaseRow('Milieu de jeu', 'middlegame')}
    ${phaseRow('Finale', 'endgame')}
    <div class="sum-row"><span class="name">Perte moy. (cp)</span>
      <span class="cnt" style="font-size:14px;color:var(--text-2)">${W.acpl ?? '—'}</span>
      <span class="cnt" style="font-size:14px;color:var(--text-2)">${B.acpl ?? '—'}</span></div>
    ${opening ? `<div class="opening-line">${classIcon('book', 16)} ${esc(opening.split('|')[0])} · ${esc(opening.split('|')[1])}</div>` : ''}`;
}

let storyTab = 'moments';

/** Prépare la carte « Récit de la partie » du résumé. */
function renderStory() {
  const n = S.narrative;
  const ok = !!(n && n.sections.length);
  $('btn-story').hidden = !ok;
  $('btn-story-foot').hidden = !ok;
  if (!ok) return;
  $('story-cta-sub').textContent = `${n.headline} · ${n.moments.length} moment${n.moments.length > 1 ? 's' : ''} clé${n.moments.length > 1 ? 's' : ''}`;
  if (!$('story-modal').hidden) renderStoryModal();
}

function openStory(tab) {
  if (!S.narrative) return;
  if (tab) storyTab = tab;
  $('story-modal').hidden = false;
  renderStoryModal();
}

function closeStory() { $('story-modal').hidden = true; }

function renderStoryModal() {
  const n = S.narrative, g = S.game, P = S.result.summary.players;
  $('story-title').textContent = n.headline;
  const side = c => {
    const p = c === 'w' ? g.white : g.black;
    const acc = P[c].accuracy;
    return `<div class="sm-player ${c}">
      ${avatarHtml(c)}
      <div class="sm-name"><b>${esc(p?.name || COLOR_NAME[c])}</b><small>${p?.rating ? esc(p.rating) + ' Elo' : COLOR_NAME[c]}</small></div>
      <span class="sm-acc">${acc == null ? '—' : acc.toFixed(1)}<small>précision</small></span>
    </div>`;
  };
  const res = g.result && g.result !== '*' ? g.result.replace('1/2-1/2', '½-½') : '—';
  const opening = S.result.summary.opening;
  $('story-match').innerHTML = `${side('w')}<div class="sm-res"><b>${esc(res)}</b>${opening ? `<small>${esc(opening.split('|')[1])}</small>` : ''}</div>${side('b')}`;
  $('story-tabs').querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === storyTab);
    b.onclick = () => { storyTab = b.dataset.tab; renderStoryModal(); };
  });
  const body = $('story-body');
  if (storyTab === 'moments') {
    body.innerHTML = n.moments.length ? `<div class="timeline">${n.moments.map(m => {
      const a = S.result.moves[m.ply];
      const ev = S.evals?.[m.ply] ? formatScore(S.evals[m.ply].lines[0].score) : '';
      const white = S.evals?.[m.ply] ? scoreToCp(S.evals[m.ply].lines[0].score) >= 0 : true;
      return `<article class="tl-item" data-ply="${m.ply}" style="--c:${CLASSES[m.icon]?.color || '#81b64c'}">
        <div class="tl-node">${classIcon(m.icon, 30)}</div>
        <div class="tl-card">
          <div class="tl-top"><span class="tl-move">${esc(moveLabelFor(m.ply))}</span><span class="tl-title">${esc(m.title)}</span>${ev ? `<span class="evchip ${white ? 'w' : 'b'}">${ev}</span>` : ''}</div>
          <p>${m.html}</p>
          <span class="tl-go">${icon('board', 14)}Voir sur l'échiquier</span>
        </div>
      </article>`;
    }).join('')}</div>` : '<p class="story-empty">Aucun moment marquant : une partie très calme !</p>';
    body.querySelectorAll('.tl-item').forEach(el => el.onclick = e => {
      if (e.target.closest('.mref')) return;
      closeStory();
      setView('review');
      goTo(+el.dataset.ply);
    });
  } else if (storyTab === 'story') {
    body.innerHTML = `<div class="chapters">${n.sections.map((sec, i) => `
      <section class="chapter" style="--c:${CLASSES[sec.icon]?.color || '#81b64c'}">
        <div class="chapter-head"><span class="chapter-num">${i + 1}</span>${classIcon(sec.icon, 20)}<h3>${esc(sec.title)}</h3></div>
        <p>${sec.html}</p>
      </section>`).join('')}</div>`;
  } else {
    body.innerHTML = n.tips.length ? `<div class="tips-grid">${n.tips.map(t => `
      <div class="tip-card" style="--c:${CLASSES[t.icon]?.color || '#81b64c'}">${classIcon(t.icon, 26)}<p>${t.html}</p></div>`).join('')}</div>`
      : '<p class="story-empty">Rien à signaler : continuez comme ça !</p>';
  }
  body.scrollTop = 0;
}

function moveLabelFor(ply) {
  const m = S.positions[ply].move;
  const startNum = +(S.positions[0].fen.split(' ')[5]) || 1;
  const blackFirst = S.positions[0].fen.split(' ')[1] === 'b';
  const num = startNum + Math.floor((ply - 1 + (blackFirst ? 1 : 0)) / 2);
  return `${num}${m.color === 'w' ? '.' : '…'} ${m.san}`;
}

function coachSummary(players) {
  const g = S.game;
  const me = (S.settings.username || '').toLowerCase();
  const myColor = me && (g.white?.name || '').toLowerCase() === me ? 'w' : me && (g.black?.name || '').toLowerCase() === me ? 'b' : null;
  const r = g.result;
  const winner = r === '1-0' ? 'w' : r === '0-1' ? 'b' : r === '1/2-1/2' ? 'draw' : null;
  let head;
  if (myColor) head = winner === 'draw' ? 'Partie nulle.' : winner === myColor ? 'Belle victoire !' : winner ? 'Défaite, mais il y a de quoi apprendre.' : 'Partie analysée.';
  else head = winner === 'draw' ? 'Partie nulle.' : winner ? `Victoire des ${COLOR_NAME[winner]} (${esc(winner === 'w' ? g.white?.name : g.black?.name)}).` : 'Partie analysée.';
  const parts = [`<b>${head}</b>`];
  if (g.termination) parts.push(`<span style="color:#6b6966">${esc(g.termination)}</span>`);
  const focus = myColor ? [myColor] : ['w', 'b'];
  for (const c of focus) {
    const p = players[c];
    if (p.accuracy == null) continue;
    const who = myColor ? 'Votre' : `${COLOR_NAME[c]} :`;
    const bits = [];
    if (p.counts.brilliant) bits.push(`${p.counts.brilliant} coup${p.counts.brilliant > 1 ? 's' : ''} brillant${p.counts.brilliant > 1 ? 's' : ''} !!`);
    if (p.counts.great) bits.push(`${p.counts.great} très bon${p.counts.great > 1 ? 's' : ''} coup${p.counts.great > 1 ? 's' : ''}`);
    if (p.counts.blunder) bits.push(`${p.counts.blunder} gaffe${p.counts.blunder > 1 ? 's' : ''}`);
    if (p.counts.miss) bits.push(`${p.counts.miss} occasion${p.counts.miss > 1 ? 's' : ''} manquée${p.counts.miss > 1 ? 's' : ''}`);
    parts.push(`${who} précision ${p.accuracy.toFixed(1)} % (≈ ${p.elo})${bits.length ? ' — ' + bits.join(', ') : ''}.`);
  }
  return parts.join('<br>');
}

/* ====================================================================== */
/* Navigation & affichage                                                  */
/* ====================================================================== */

function currentNode() {
  if (S.retry) {
    if (S.retry.after) return { fen: S.retry.after.fen, move: S.retry.after.move, ply: S.retry.ply, inVar: true, retry: true };
    return { fen: S.positions[S.retry.ply - 1].fen, move: S.positions[S.retry.ply - 1].move, ply: S.retry.ply - 1, inVar: true, retry: true };
  }
  const v = S.variation;
  if (v && v.idx >= 0) {
    const m = v.moves[v.idx];
    return { fen: m.fen, move: m, ply: v.base + v.idx + 1, inVar: true };
  }
  const p = S.positions[S.cur];
  return { fen: p.fen, move: p.move, ply: S.cur, inVar: false };
}

function goTo(ply, { sound = false } = {}) {
  if (!S.positions) return;
  S.retry = null;
  S.variation = null;
  const prev = S.cur;
  S.cur = Math.max(0, Math.min(S.positions.length - 1, ply));
  display({ sound: sound || Math.abs(S.cur - prev) === 1 && S.cur > prev, animate: Math.abs(S.cur - prev) <= 1 });
  scrollToCurrent();
}

function navNext() {
  if (S.retry) return;
  const v = S.variation;
  if (v) {
    if (v.idx < v.moves.length - 1) { v.idx++; display({ sound: true }); }
    return;
  }
  if (S.cur < S.positions.length - 1) goTo(S.cur + 1, { sound: true });
}
function navPrev() {
  if (S.retry) return exitRetry();
  const v = S.variation;
  if (v) {
    if (v.idx >= 0) { v.idx--; display(); return; }
    S.variation = null;
  }
  if (S.cur > 0) goTo(S.cur - 1);
}
function navFirst() { goTo(0); }
function navLast() { goTo(S.positions.length - 1); }

function flip() {
  board.flip();
  S.orientation = board.opts.orientation;
  renderPlayers();
  updateEvalBar();
}

function kingSquare(c, color) {
  const b = c.board();
  for (const row of b) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}

function display({ animate = true, sound = false } = {}) {
  if (!S.positions) return;
  const node = currentNode();
  const s = S.settings;
  const a = !node.inVar && S.result ? S.result.moves[node.ply] : (node.retry && S.retry?.badge ? { cls: S.retry.badge, to: node.move?.to } : null);
  const c = new Chess(node.fen);
  const inCheck = c.inCheck();
  board.setPosition(node.fen, {
    lastMove: node.move ? [node.move.from, node.move.to] : null,
    animate,
    check: inCheck ? kingSquare(c, c.turn()) : null,
    lastMoveColor: a && s.showClassIcons ? CLASSES[a.cls].color : null,
  });
  board.setBadge(a && s.showClassIcons && node.move ? node.move.to : null, a?.cls);
  const arrows = [];
  if (a && !node.inVar && s.showArrows && a.bestUci && !GOOD_CLASSES.has(a.cls)) {
    arrows.push({ from: a.bestUci.slice(0, 2), to: a.bestUci.slice(2, 4), color: 'rgba(150,190,70,.85)', width: 0.2 });
  }
  board.setArrows(arrows);
  if (sound) {
    if (c.isCheckmate()) play('end');
    else playForMove(node.move, inCheck);
  }
  renderPlayers();
  updateEvalBar();
  renderCoach();
  highlightMove();
  renderVariation();
  updateGraphs();
  renderEngineLines();
  requestLive();
}

function updateGraphs() {
  if (!S.evals) return;
  const wins = S.evals.map(e => winPct(scoreToCp(e.lines[0].score)));
  const classes = S.result ? S.result.moves.map(m => m?.cls) : [];
  const show = S.settings.showGraph;
  $('summary-graph').hidden = !show;
  $('review-graph').hidden = !show;
  summaryGraph.set({ wins, classes, cur: S.cur });
  reviewGraph.set({ wins, classes, cur: S.cur });
}

/* ----- Barre d'évaluation ----- */

function currentScore() {
  if (!S.positions) return null;
  const node = currentNode();
  if (S.liveOn && S.liveInfo && S.liveInfo.fen === node.fen && S.liveInfo.lines[0] && (node.inVar || !S.evals)) return S.liveInfo.lines[0].score;
  if (!node.inVar && S.evals) return S.evals[node.ply].lines[0].score;
  if (S.liveInfo && S.liveInfo.fen === node.fen && S.liveInfo.lines[0]) return S.liveInfo.lines[0].score;
  return null;
}

function updateEvalBar() {
  const bar = $('evalbar');
  bar.classList.toggle('off', !S.settings.showEvalBar);
  bar.classList.toggle('flipped', S.orientation === 'b');
  const sc = currentScore();
  const fill = $('evalbar-white'), text = $('evalbar-text');
  if (!sc) { fill.style.height = '50%'; text.textContent = ''; return; }
  const cp = scoreToCp(sc);
  let w = winPct(cp);
  if (sc.mate != null) w = sc.mate === 0 ? (sc.mated === 'w' ? 0 : 100) : sc.mate > 0 ? 100 : 0;
  fill.style.height = Math.max(0, Math.min(100, w)) + '%';
  const whiteAhead = sc.mate != null ? (sc.mate === 0 ? sc.mated === 'b' : sc.mate > 0) : cp >= 0;
  text.className = 'evalbar-text ' + (whiteAhead ? 'on-white' : 'on-black');
  text.textContent = sc.mate != null ? (sc.mate === 0 ? '#' : 'M' + Math.abs(sc.mate)) : Math.abs(cp / 100).toFixed(1);
}

/* ----- Joueurs, pendules, matériel ----- */

function parseTimeControl(tc) {
  const m = /^(\d+)(?:\+(\d+(?:\.\d+)?))?$/.exec(tc || '');
  return m ? { base: +m[1], inc: +(m[2] || 0) } : null;
}

function clockAt(color, ply) {
  const clocks = S.game?.clocks;
  if (!clocks) return null;
  for (let k = Math.min(ply, S.positions.length - 1); k >= 1; k--) {
    if (S.positions[k].move.color === color && clocks[k - 1] != null) return clocks[k - 1];
  }
  return parseTimeControl(S.game.timeControl)?.base ?? null;
}

function fmtClock(sec) {
  if (sec == null) return '';
  const neg = sec < 0;
  sec = Math.abs(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const ss = sec < 20 ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return (neg ? '-' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`);
}

function material(fen) {
  const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const ch of fen.split(' ')[0]) {
    const t = ch.toLowerCase();
    if (t in cnt.w) cnt[ch === t ? 'b' : 'w'][t]++;
  }
  return cnt;
}

function renderPlayers() {
  if (!S.game) return;
  const node = S.positions ? currentNode() : null;
  const fen = node?.fen || new Chess().fen();
  const mat = material(fen);
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const val = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const score = c => Object.entries(mat[c]).reduce((s, [k, n]) => s + n * val[k], 0);
  const turn = fen.split(' ')[1];
  const ended = node && !node.inVar && node.ply === S.positions.length - 1 && S.game.result !== '*';
  const bar = (el, color) => {
    const p = color === 'w' ? S.game.white : S.game.black;
    const opp = color === 'w' ? 'b' : 'w';
    let caps = '';
    for (const k of ['p', 'b', 'n', 'r', 'q']) {
      const missing = Math.max(0, start[k] - mat[opp][k]);
      if (!missing) continue;
      const src = `../img/pieces/${S.settings.pieceSet}/${opp}${k.toUpperCase()}.svg`;
      caps += `<span class="cap-group">${`<img src="${src}" alt="">`.repeat(missing)}</span>`;
    }
    const adv = score(color) - score(opp);
    const clk = S.settings.showClocks && node ? clockAt(color, node.inVar ? Math.min(node.ply, S.cur) : node.ply) : null;
    el.innerHTML = `${avatarHtml(color)}
      <span class="pname">${esc(p?.name || COLOR_NAME[color])}</span>
      ${p?.rating ? `<span class="prating">(${esc(p.rating)})</span>` : ''}
      <span class="captured">${caps}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</span>
      <span class="spacer"></span>
      ${clk != null ? `<span class="clock ${color === 'w' ? 'white' : 'black'} ${turn === color && !ended ? 'active' : ''}">${fmtClock(clk)}</span>` : ''}`;
  };
  const top = S.orientation === 'w' ? 'b' : 'w';
  bar($('player-top'), top);
  bar($('player-bottom'), top === 'w' ? 'b' : 'w');
}

/* ----- Liste des coups ----- */

function renderMoves() {
  const el = $('moves');
  el.innerHTML = '';
  if (!S.positions || S.positions.length === 1) {
    el.innerHTML = '<div class="empty" style="padding:12px">Jouez des coups sur l\'échiquier : Stockfish analyse en direct.</div>';
    $('opening-name').textContent = '';
    return;
  }
  const s = S.settings;
  const clocks = S.game.clocks;
  const tc = parseTimeControl(S.game.timeControl);
  const spent = [];
  if (clocks && s.showClocks) {
    for (let k = 1; k < S.positions.length; k++) {
      const color = S.positions[k].move.color;
      let prevClock = tc?.base ?? null;
      for (let j = k - 1; j >= 1; j--) if (S.positions[j].move.color === color) { prevClock = clocks[j - 1]; break; }
      spent[k] = prevClock != null && clocks[k - 1] != null ? Math.max(0, prevClock - clocks[k - 1] + (k > 2 ? (tc?.inc || 0) : 0)) : null;
    }
  }
  const maxSpent = Math.max(1, ...spent.filter(x => x != null));
  const startNum = +(S.positions[0].fen.split(' ')[5]) || 1;
  const blackFirst = S.positions[0].fen.split(' ')[1] === 'b';
  let row = null;
  for (let k = 1; k < S.positions.length; k++) {
    const m = S.positions[k].move;
    if (m.color === 'w' || !row) {
      row = document.createElement('div');
      row.className = 'mrow';
      const num = startNum + Math.floor((k - 1 + (blackFirst ? 1 : 0)) / 2);
      row.innerHTML = `<span class="mnum">${num}.</span>`;
      if (m.color === 'b') row.appendChild(document.createElement('span'));
      el.appendChild(row);
    }
    const a = S.result?.moves[k];
    const cell = document.createElement('span');
    cell.className = 'mv' + (a ? ' c-' + a.cls : '');
    cell.dataset.ply = k;
    const t = spent[k];
    cell.innerHTML = `${a && s.showClassIcons ? classIcon(a.cls, 17) : ''}<span class="san">${esc(m.san)}</span>${t != null ? `<span class="t">${t < 10 ? t.toFixed(1) : Math.round(t)}s<i style="width:${Math.max(2, t / maxSpent * 26)}px"></i></span>` : ''}`;
    cell.onclick = () => { setView('review'); goTo(k); };
    row.appendChild(cell);
  }
  const res = document.createElement('div');
  res.className = 'game-result';
  res.innerHTML = `${esc(S.game.result || '*')}${S.game.termination ? `<small>${esc(S.game.termination)}</small>` : ''}`;
  el.appendChild(res);
  highlightMove();
}

function highlightMove() {
  const el = $('moves');
  el.querySelectorAll('.mv.cur').forEach(x => x.classList.remove('cur'));
  const ply = S.variation ? S.variation.base : S.retry ? S.retry.ply - 1 : S.cur;
  const cell = el.querySelector(`.mv[data-ply="${ply}"]`);
  if (cell) cell.classList.add('cur');
  const op = S.result?.moves.slice(1, ply + 1).filter(Boolean).map(m => m.opening).filter(Boolean).pop() || null;
  $('opening-name').innerHTML = op ? `${classIcon('book', 14)} ${esc(op.split('|')[0])} · ${esc(op.split('|')[1])}` : '';
}

function scrollToCurrent() {
  const box = $('moves');
  $('view-review').scrollTop = 0;
  const cell = box.querySelector('.mv.cur');
  if (!cell) { if (S.cur === 0) box.scrollTop = 0; return; }
  const b = box.getBoundingClientRect(), c = cell.getBoundingClientRect();
  if (c.top < b.top + 4) box.scrollTop -= b.top - c.top + 40;
  else if (c.bottom > b.bottom - 4) box.scrollTop += c.bottom - b.bottom + 40;
}

/* ----- Coach ----- */

function renderCoach() {
  if (S.view !== 'review') return;
  const title = $('coach-title'), text = $('coach-text'), actions = $('coach-actions');
  actions.innerHTML = '';
  const node = currentNode();
  const addBtn = (label, fn, primary = false, ico = null) => {
    const b = document.createElement('button');
    b.className = 'btn' + (primary ? ' btn-primary' : '');
    b.innerHTML = (ico ? icon(ico, 15) : '') + esc(label);
    b.onclick = fn;
    actions.appendChild(b);
  };

  if (S.retry) {
    const r = S.retry;
    const a = S.result.moves[r.ply];
    if (!r.after) {
      title.innerHTML = `${icon('target', 20)} Réessayez`;
      text.textContent = `Trouvez un meilleur coup que ${a.san} pour les ${COLOR_NAME[a.color]}.`;
    } else {
      title.innerHTML = `${r.badge ? classIcon(r.badge, 22) : ''} ${esc(r.title || '')}`;
      text.textContent = r.message || '';
    }
    if (r.state === 'success' || r.state === 'solution') addBtn('Continuer', () => { exitRetry(); goTo(r.ply); }, true, 'next');
    else if (r.state === 'checking') addBtn('Vérification…', () => {});
    else { addBtn('Voir la solution', showSolution, false, 'bulb'); addBtn('Annuler', exitRetry, false, 'x'); }
    return;
  }

  if (!S.positions || S.positions.length === 1 || !S.result) {
    title.textContent = node.inVar ? 'Analyse libre' : 'Plateau libre';
    text.textContent = 'Jouez des coups ou cliquez sur une ligne du moteur. Clic droit pour dessiner des flèches.';
    if (S.variation) addBtn('Réinitialiser', closeVariation, false, 'refresh');
    return;
  }

  if (node.inVar) {
    const sc = currentScore();
    title.innerHTML = `${icon('branch', 20)} Variante${sc ? evalChip(sc) : ''}`;
    text.textContent = 'Vous explorez une variante. Stockfish analyse la position en direct.';
    addBtn('Revenir à la partie', closeVariation, true, 'prev');
    return;
  }

  const a = S.result.moves[node.ply];
  if (!a) {
    title.textContent = 'Position de départ';
    text.textContent = 'Utilisez ▶ ou la flèche → pour parcourir la partie. Cliquez sur un coup ou sur le graphique pour y accéder.';
    addBtn('Premier coup', () => goTo(1), true, 'next');
    return;
  }
  const ex = explainRich(a, S.positions, S.evals);
  title.innerHTML = `${classIcon(a.cls, 24)}<span style="color:${CLASSES[a.cls].color === '#81b64c' ? '#5d8c32' : 'inherit'}">${esc(ex.title)}</span>${evalChip(a.scoreAfter)}`;
  text.innerHTML = ex.paragraphs.map(p => `<p>${p}</p>`).join('');
  const moment = S.narrative?.moments.find(m => m.ply === a.ply);
  if (moment) {
    const d = document.createElement('div');
    d.className = 'coach-moment';
    d.innerHTML = `<b>${icon('bolt', 13)} Moment clé · ${esc(moment.title)}</b><br>${moment.html}`;
    text.appendChild(d);
  }
  if (ERROR_CLASSES.has(a.cls) || a.cls === 'good' || a.cls === 'excellent') {
    if (a.bestUci) addBtn('Meilleur coup', () => showBestLine(a), false, 'star');
    if (ERROR_CLASSES.has(a.cls)) addBtn('Réessayer', () => startRetry(a.ply), true, 'refresh');
  } else if (a.bestUci && a.cls !== 'book') {
    addBtn('Voir la suite', () => showEngineLine(node.ply), false, 'branch');
  }
  const nextErr = S.result.moves.find(m => m && m.ply > a.ply && ERROR_CLASSES.has(m.cls) && (!myColor() || m.color === myColor()));
  if (nextErr) addBtn('Erreur suivante', () => goTo(nextErr.ply), false, 'last');
  const nextMoment = S.narrative?.moments.find(m => m.ply > a.ply);
  if (nextMoment) addBtn('Moment clé', () => goTo(nextMoment.ply), false, 'bolt');
}

function myColor() {
  const me = (S.settings.username || '').toLowerCase();
  if (!me || !S.game) return null;
  if ((S.game.white?.name || '').toLowerCase() === me) return 'w';
  if ((S.game.black?.name || '').toLowerCase() === me) return 'b';
  return null;
}

function evalChip(score) {
  const s = formatScore(score);
  const white = scoreToCp(score) >= 0;
  return `<span class="eval-chip ${white ? 'white' : ''}">${s}</span>`;
}

/* ====================================================================== */
/* Variantes                                                               */
/* ====================================================================== */

function getDests(sq) {
  if (!S.positions || S.view === 'progress' || S.view === 'load') return [];
  if (S.retry && (S.retry.after || S.retry.state === 'checking')) return [];
  const node = currentNode();
  const c = new Chess(node.fen);
  if (S.retry && c.turn() !== S.retry.color) return [];
  return c.moves({ square: sq, verbose: true }).map(m => ({ to: m.to, promotion: m.promotion }));
}

function varMove(m, fen) {
  return { san: m.san, uci: m.from + m.to + (m.promotion || ''), from: m.from, to: m.to, color: m.color, captured: m.captured, promotion: m.promotion, flags: m.flags, fen };
}

function onUserMove({ from, to, promotion }) {
  if (S.retry) return retryMove({ from, to, promotion });
  if (S.view === 'summary') setView('review');
  const node = currentNode();
  const c = new Chess(node.fen);
  let m;
  try { m = c.move({ from, to, promotion }); } catch { m = null; }
  if (!m) return display({ animate: false });
  applyMove(m, c.fen(), node);
  display({ sound: true });
}

function applyMove(m, fenAfter, node) {
  const uci = m.from + m.to + (m.promotion || '');
  if (!node.inVar) {
    const next = S.positions[S.cur + 1];
    if (next && next.move.uci === uci) { S.cur++; return; }
    S.variation = { base: S.cur, moves: [], idx: -1 };
  }
  const v = S.variation;
  if (v.moves[v.idx + 1] && v.moves[v.idx + 1].uci === uci) { v.idx++; return; }
  v.moves = v.moves.slice(0, v.idx + 1);
  v.moves.push(varMove(m, fenAfter));
  v.idx++;
}

/** Joue une suite de coups UCI depuis la position affichée (crée une variante). */
function playUciLine(ucis, upto = ucis.length) {
  for (const u of ucis.slice(0, upto)) {
    const node = currentNode();
    const c = new Chess(node.fen);
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { m = null; }
    if (!m) break;
    applyMove(m, c.fen(), node);
  }
  display({ sound: true });
}

function closeVariation() {
  if (!S.variation) return;
  S.variation = null;
  display({ animate: false });
}

function showBestLine(a) {
  S.variation = null;
  S.cur = a.ply - 1;
  const pv = S.evals[a.ply - 1].lines[0].pv;
  playUciLine(pv, 1);
  if (S.variation) S.variation.moves.push(...lineMoves(S.variation.moves[0].fen, pv.slice(1, 8)));
  display({ animate: true });
}

function showEngineLine(ply) {
  const pv = S.evals[ply].lines[0].pv;
  if (!pv.length) return;
  S.variation = { base: ply, moves: lineMoves(S.positions[ply].fen, pv.slice(0, 8)), idx: 0 };
  display({ sound: true });
}

function lineMoves(fen, ucis) {
  const c = new Chess(fen);
  const out = [];
  for (const u of ucis) {
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { m = null; }
    if (!m) break;
    out.push(varMove(m, c.fen()));
  }
  return out;
}

function renderVariation() {
  const el = $('variation');
  const v = S.variation;
  if (!v || !v.moves.length || S.view !== 'review') { el.hidden = true; return; }
  el.hidden = false;
  const baseFen = S.positions[v.base].fen;
  let num = +baseFen.split(' ')[5] || 1;
  let html = '<span class="vlabel">Variante</span>';
  v.moves.forEach((m, i) => {
    const label = m.color === 'w' ? `${num}. ${m.san}` : (i === 0 ? `${num}… ${m.san}` : m.san);
    if (m.color === 'b') num++;
    html += `<span class="vm ${i === v.idx ? 'cur' : ''}" data-i="${i}">${esc(label)}</span>`;
  });
  html += `<button class="vclose" title="Fermer la variante (Échap)">${icon('x', 14)}</button>`;
  el.innerHTML = html;
  el.querySelectorAll('.vm').forEach(x => x.onclick = () => { v.idx = +x.dataset.i; display(); });
  el.querySelector('.vclose').onclick = closeVariation;
}

/* ====================================================================== */
/* Réessayer                                                               */
/* ====================================================================== */

function startRetry(ply) {
  const a = S.result.moves[ply];
  S.variation = null;
  S.cur = ply - 1;
  S.retry = { ply, color: a.color, after: null, state: 'try', tries: 0 };
  stopLive();
  display({ animate: true });
}

function exitRetry() {
  if (!S.retry) return;
  const ply = S.retry.ply;
  S.retry = null;
  S.cur = ply - 1;
  display({ animate: false });
}

async function retryMove({ from, to, promotion }) {
  const r = S.retry;
  const a = S.result.moves[r.ply];
  const c = new Chess(S.positions[r.ply - 1].fen);
  let m;
  try { m = c.move({ from, to, promotion }); } catch { m = null; }
  if (!m) return display({ animate: false });
  const uci = m.from + m.to + (m.promotion || '');
  r.after = { fen: c.fen(), move: varMove(m, c.fen()) };
  r.tries++;
  if (uci === a.bestUci) return retryResult('best', `${m.san} est le meilleur coup !`, 'Bien joué, c\'est exactement ce que Stockfish recommande.', true);
  if (uci === a.uci) return retryResult('mistake', `${m.san}… c'est le coup de la partie`, 'Cherchez autre chose !', false);
  r.state = 'checking';
  r.badge = null;
  r.title = m.san;
  r.message = 'Stockfish vérifie votre coup…';
  display({ sound: true });
  const engine = await ensureEngine();
  const res = await engine.analyse(c.fen(), { depth: Math.min(18, S.settings.depth), multipv: 1 });
  if (S.retry !== r) return;
  const sc = res.lines[0]?.score || { cp: 0, mate: null };
  const loss = a.winBefore - moverWin(sc, a.color);
  if (loss < 2) retryResult('excellent', `${m.san} est excellent !`, `Très proche du meilleur coup (${a.bestSan}).`, true);
  else if (loss < 5) retryResult('good', `${m.san} est un bon coup`, `Mieux que ${a.san} ! Le meilleur était ${a.bestSan}.`, true);
  else retryResult('mistake', `${m.san} n'est pas le bon coup`, 'Réessayez !', false);
}

function retryResult(badge, title, message, ok) {
  const r = S.retry;
  r.badge = badge;
  r.title = title;
  r.message = message;
  r.state = ok ? 'success' : 'fail';
  play(ok ? 'success' : 'error');
  display({ sound: false, animate: true });
  if (!ok) {
    setTimeout(() => {
      if (S.retry !== r) return;
      r.after = null;
      r.badge = null;
      r.state = 'try';
      display({ animate: true });
      const t = $('coach-text');
      t.textContent = `Pas tout à fait. Essai n°${r.tries + 1} : trouvez mieux que ${S.result.moves[r.ply].san}.`;
    }, 1100);
  }
}

function showSolution() {
  const r = S.retry;
  const a = S.result.moves[r.ply];
  const c = new Chess(S.positions[r.ply - 1].fen);
  const m = c.move({ from: a.bestUci.slice(0, 2), to: a.bestUci.slice(2, 4), promotion: a.bestUci[4] });
  r.after = { fen: c.fen(), move: varMove(m, c.fen()) };
  r.badge = 'best';
  r.title = `${m.san} était le meilleur coup`;
  r.message = explainRich(a, S.positions, S.evals).paragraphs.join(' ').replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  r.state = 'solution';
  display({ sound: true });
}

/* ====================================================================== */
/* Moteur en direct                                                        */
/* ====================================================================== */

async function ensureEngine() {
  if (S.enginePromise) return S.enginePromise;
  const s = S.settings;
  S.enginePromise = (async () => {
    const flavor = await usableEngine(s.engine);
    const e = new Engine(flavor);
    S.engine = e;
    S.live = new LiveAnalyzer(e, onLiveInfo);
    await e.init({ hash: Math.max(16, s.hash), threads: s.threads });
    setStatus('ready', e.isMT ? 'Stockfish 19 Lite MT ×' + s.threads : flavor === 'full-single' ? 'Stockfish 19 NNUE' : 'Stockfish 19 Lite');
    return e;
  })();
  return S.enginePromise;
}

function restartEngine() {
  if (S.engine) S.engine.terminate();
  S.engine = null;
  S.enginePromise = null;
  S.live = null;
  S.liveInfo = null;
  if (S.liveOn) requestLive();
}

async function requestLive() {
  if (!S.liveOn || S.view !== 'review' || S.retry || !S.positions) return;
  const node = currentNode();
  const c = new Chess(node.fen);
  if (c.isGameOver()) { S.liveInfo = null; renderEngineLines(); return; }
  if (S.liveInfo?.fen === node.fen && S.liveInfo.final) return;
  await ensureEngine();
  if (currentNode().fen !== node.fen) return;
  S.live.request(node.fen, { depth: S.settings.liveDepth, multipv: S.settings.multipv });
}

function stopLive() {
  if (S.live) S.live.stop();
}

function onLiveInfo(info, final) {
  if (!S.positions || info.fen !== currentNode().fen) return;
  S.liveInfo = { fen: info.fen, lines: info.lines, depth: info.depth, final };
  renderEngineLines();
  updateEvalBar();
  if (S.view === 'review' && currentNode().inVar && !S.retry) {
    const sc = currentScore();
    const chip = $('coach-title').querySelector('.eval-chip');
    if (chip && sc) chip.outerHTML = evalChip(sc);
  }
}

function renderEngineLines() {
  const el = $('engine-lines');
  if (!S.positions) { el.innerHTML = ''; return; }
  const node = currentNode();
  let lines = null, depth = null, label = '';
  if (S.liveOn && S.liveInfo && S.liveInfo.fen === node.fen) {
    lines = S.liveInfo.lines; depth = S.liveInfo.depth;
    label = `Prof. ${depth}${S.liveInfo.final ? '' : '…'}`;
  } else if (!node.inVar && S.evals) {
    lines = S.evals[node.ply].lines; depth = S.evals[node.ply].depth;
    label = `Bilan · prof. ${depth}`;
  }
  $('engine-meta').textContent = S.liveOn ? (label || 'Calcul…') : (label || 'Moteur désactivé');
  const ev = $('engine-eval');
  if (lines && lines[0]) {
    const sc = lines[0].score;
    ev.textContent = formatScore(sc);
    ev.classList.toggle('neg', scoreToCp(sc) < 0);
  } else { ev.textContent = '—'; ev.classList.remove('neg'); }
  el.innerHTML = '';
  if (!lines) return;
  for (const l of lines.slice(0, S.settings.multipv)) {
    if (!l.pv?.length) continue;
    const row = document.createElement('div');
    row.className = 'engine-line';
    const sans = pvToSan(node.fen, l.pv, 14);
    row.innerHTML = `<span class="sc ${scoreToCp(l.score) < 0 ? 'neg' : ''}">${formatScore(l.score)}</span><span class="pv">${sans.map((m, i) => `<span data-i="${i + 1}">${esc(m.label)}</span>`).join(' ')}</span>`;
    row.onclick = e => {
      if (S.retry) return;
      if (S.view === 'summary') setView('review');
      const i = +(e.target.dataset?.i || 1);
      const pv = l.pv.slice();
      const fen = node.fen;
      if (currentNode().fen !== fen) return;
      // ajoute la ligne en variante et se place au coup cliqué
      const moves = lineMoves(fen, pv.slice(0, 14));
      if (!moves.length) return;
      if (!node.inVar) S.variation = { base: S.cur, moves: [], idx: -1 };
      const v = S.variation;
      v.moves = v.moves.slice(0, v.idx + 1).concat(moves);
      v.idx = Math.min(v.moves.length - 1, v.idx + i);
      display({ sound: true });
    };
    el.appendChild(row);
  }
}

/* ====================================================================== */
/* Paramètres                                                              */
/* ====================================================================== */

const CLASSIFY_KEYS = new Set(['strictness', 'enableBrilliant', 'enableGreat', 'enableMiss', 'enableBook', 'brilliantPawnSacs', 'blunderNeedsMaterial', '*']);
const ENGINE_KEYS = new Set(['engine', 'hash', 'threads', '*']);

async function openSettings() {
  $('settings-modal').hidden = false;
  await renderSettings($('settings-body'), (s, key) => {
    S.settings = s;
    applyVisualSettings();
    if (CLASSIFY_KEYS.has(key) && S.evals) { reclassify(); }
    if (ENGINE_KEYS.has(key)) restartEngine();
    if (key === 'multipv' || key === 'liveDepth') { S.liveInfo = null; requestLive(); }
    if (S.positions) display({ animate: false });
  });
}

function applyVisualSettings() {
  const s = S.settings;
  configureSound(s);
  board.setOptions({ theme: s.boardTheme, pieceSet: s.pieceSet, coords: s.showCoords, animMs: s.animationMs, autoQueen: s.autoQueen });
  updateEvalBar();
  if (S.result) renderMoves();
}

/* ====================================================================== */
/* Divers                                                                  */
/* ====================================================================== */

function copyPgn() {
  const g = S.game;
  const c = new Chess(g.startFen || undefined);
  const h = { Event: g.event || '?', Site: g.url || 'Chess Analyzer', Date: g.date || '?', White: g.white?.name || '?', Black: g.black?.name || '?', Result: g.result || '*' };
  if (g.white?.rating) h.WhiteElo = String(g.white.rating);
  if (g.black?.rating) h.BlackElo = String(g.black.rating);
  if (g.timeControl) h.TimeControl = g.timeControl;
  for (const [k, v] of Object.entries(h)) c.setHeader(k, v);
  for (let i = 1; i < S.positions.length; i++) {
    const m = S.positions[i].move;
    c.move({ from: m.from, to: m.to, promotion: m.promotion || undefined });
    const a = S.result?.moves[i];
    if (a) c.setComment(`${CLASSES[a.cls].label} [%eval ${formatScore(a.scoreAfter).replace('+', '')}]`);
  }
  navigator.clipboard.writeText(c.pgn()).then(() => toast('PGN annoté copié dans le presse-papiers'));
}

init();
