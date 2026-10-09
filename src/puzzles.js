// Entraînement aux puzzles tirés de vos propres erreurs.
import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { Engine, EnginePool } from './engine.js';
import { loadSettings, onSettingsChanged } from './settings.js';
import { renderSettings } from './settings-ui.js';
import { classIcon } from './classes.js';
import { buildPositions, evaluatePositions, classifyGame, extractPuzzles, moverWin, isMateFor } from './analysis.js';
import { fetchRecentGames, parsePgn } from './chesscom.js';
import { getPuzzles, addPuzzles, updatePuzzle, deletePuzzles, getPuzzleStats, savePuzzleStats } from './storage.js';
import { configureSound, play, playForMove } from './sound.js';
import { icon, hydrateIcons } from './icons.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLOR_NAME = { w: 'Blancs', b: 'Noirs' };

let settings, board, engine = null, enginePromise = null;
let puzzles = [], stats, queue = [];
const P = { p: null, step: 0, fen: null, state: 'idle', counted: false, hint: 0, last: null };
let genPool = null;

async function init() {
  hydrateIcons();
  settings = await loadSettings();
  configureSound(settings);
  onSettingsChanged(s => { settings = s; });
  board = new Board($('board'), {
    theme: settings.boardTheme, pieceSet: settings.pieceSet, coords: settings.showCoords,
    animMs: settings.animationMs, autoQueen: settings.autoQueen,
    getDests, onMove,
  });
  board.setPosition(new Chess().fen(), { animate: false });
  $('gen-user').value = settings.username || '';
  $('btn-hint').onclick = hint;
  $('btn-solution').onclick = showSolution;
  $('btn-retry').onclick = () => P.p && start(P.p);
  $('btn-next').onclick = next;
  $('btn-gen').onclick = generate;
  $('btn-gen-stop').onclick = () => genPool?.cancel();
  $('pz-filter').onchange = () => { queue = []; renderGrid(); };
  $('pz-order').onchange = () => { queue = []; renderGrid(); };
  $('btn-settings-top').onclick = async () => {
    $('settings-modal').hidden = false;
    await renderSettings($('settings-body'), s => {
      settings = s;
      configureSound(s);
      board.setOptions({ theme: s.boardTheme, pieceSet: s.pieceSet, coords: s.showCoords, animMs: s.animationMs, autoQueen: s.autoQueen });
    });
  };
  $('settings-close').onclick = () => { $('settings-modal').hidden = true; };
  document.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (e.key === 'Enter' || e.key === 'n') next();
    if (e.key === 'h') hint();
  });
  stats = await getPuzzleStats();
  renderStats();
  puzzles = await getPuzzles();
  renderGrid();
  const id = new URLSearchParams(location.search).get('id');
  const first = (id && puzzles.find(p => p.id === id)) || pickNext();
  if (first) start(first);
  else showEmpty();
}

function showEmpty() {
  P.p = null;
  $('pz-turn').innerHTML = 'Aucun puzzle pour l\'instant';
  $('pz-msg').textContent = 'Analysez vos parties (les erreurs deviennent des puzzles) ou générez-en depuis vos parties chess.com ci-dessous.';
  $('pz-meta').textContent = '';
  $('pz-status').className = 'pz-status';
}

/* ---------- File d'attente ---------- */

function filtered() {
  const f = $('pz-filter').value;
  return puzzles.filter(p =>
    f === 'unsolved' ? !p.solved :
    f === 'failed' ? p.failed > 0 :
    f === 'mate' ? p.mate > 0 : true);
}

function sorted(list) {
  const o = $('pz-order').value;
  const l = list.slice();
  if (o === 'recent') l.sort((a, b) => b.created - a.created);
  else if (o === 'rating') l.sort((a, b) => a.rating - b.rating);
  else for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  return l;
}

function pickNext() {
  if (!queue.length) {
    let l = sorted(filtered());
    if ($('pz-order').value === 'random') {
      // priorité aux puzzles jamais réussis
      l = [...l.filter(p => !p.solved), ...l.filter(p => p.solved)];
    }
    queue = l.filter(p => p.id !== P.p?.id);
  }
  return queue.shift() || null;
}

function next() {
  const p = pickNext();
  if (p) start(p); else if (!puzzles.length) showEmpty();
}

function renderGrid() {
  const list = filtered();
  $('pz-count').textContent = `${list.length} puzzle${list.length > 1 ? 's' : ''} · ${puzzles.filter(p => p.solved).length} réussi(s) au total`;
  const g = $('pz-grid');
  g.innerHTML = '';
  for (const p of sorted(list).slice(0, 400)) {
    const t = document.createElement('div');
    t.className = 'pz-tile' + (P.p?.id === p.id ? ' cur' : '');
    t.title = `${p.theme} · ${p.source?.white || '?'} vs ${p.source?.black || '?'}`;
    t.innerHTML = `<span class="st ${p.solved ? 'ok' : p.failed ? 'ko' : 'new'}">${p.solved ? icon('check', 14) : p.failed ? icon('x', 14) : p.mate ? 'M' + p.mate : icon('target', 14)}</span>${p.rating}<button class="del" title="Supprimer">${icon('x', 11)}</button>`;
    t.onclick = e => {
      if (e.target.closest('.del')) {
        e.stopPropagation();
        deletePuzzles([p.id]).then(async () => { puzzles = await getPuzzles(); queue = []; renderGrid(); });
        return;
      }
      start(p);
    };
    g.appendChild(t);
  }
}

function renderStats(delta = 0) {
  $('pz-rating').textContent = Math.round(stats.rating) + (delta ? ` (${delta > 0 ? '+' : ''}${delta})` : '');
  $('pz-rating').className = 'pz-rating' + (delta > 0 ? ' up' : delta < 0 ? ' down' : '');
  $('st-streak').textContent = stats.streak;
  $('st-best').textContent = stats.bestStreak;
  $('st-solved').textContent = stats.solved;
  $('st-failed').textContent = stats.failed;
}

/* ---------- Déroulement d'un puzzle ---------- */

function start(p) {
  Object.assign(P, { p, step: 0, fen: p.fen, state: 'play', counted: false, hint: 0, last: null });
  board.setOrientation(p.color);
  board.setPosition(p.fen, { animate: false });
  board.setBadge(null);
  board.setArrows([]);
  $('pz-status').className = 'pz-status';
  $('pz-turn').innerHTML = `<span class="sw ${p.color}"></span> Aux ${COLOR_NAME[p.color]} de jouer`;
  $('pz-msg').textContent = p.mate ? `Trouvez le mat en ${p.mate}.` : 'Trouvez le meilleur coup.';
  const src = p.source || {};
  $('pz-meta').innerHTML = `${esc(p.theme)} · difficulté ${p.rating}${src.white ? ` · ${esc(src.white)} vs ${esc(src.black)}${src.date ? ' (' + esc(src.date) + ')' : ''}` : ''}${src.gameId ? ` · <a id="open-game">voir la partie</a>` : ''}<br>Dans la partie : ${esc(p.playedSan)} a été joué.`;
  const og = $('open-game');
  if (og) og.onclick = () => { location.href = `app.html?id=${src.gameId}&gtype=${src.gtype || 'live'}`; };
  bars();
  renderGrid();
}

function bars() {
  const p = P.p;
  const mk = c => `<span class="avatar"><img src="../img/pieces/${settings.pieceSet}/${c}K.svg" alt="" style="width:28px;height:28px"></span><span class="pname">${COLOR_NAME[c]}</span>${c === p.color ? '<span class="prating">— vous</span>' : ''}`;
  $('pz-top').innerHTML = mk(p.color === 'w' ? 'b' : 'w');
  $('pz-bottom').innerHTML = mk(p.color);
}

function getDests(sq) {
  if (!P.p || P.state !== 'play') return [];
  const c = new Chess(P.fen);
  if (c.turn() !== P.p.color) return [];
  return c.moves({ square: sq, verbose: true }).map(m => ({ to: m.to, promotion: m.promotion }));
}

function applyUci(fen, uci) {
  const c = new Chess(fen);
  const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return { m, fen: c.fen(), c };
}

async function ensureEngine() {
  if (!engine) {
    engine = new Engine('lite-single');
    enginePromise = engine.init({ hash: 32 });
  }
  await enginePromise;
  return engine;
}

async function onMove({ from, to, promotion }) {
  const p = P.p;
  const c = new Chess(P.fen);
  let m;
  try { m = c.move({ from, to, promotion }); } catch { m = null; }
  if (!m) return board.setPosition(P.fen, { animate: false });
  const uci = m.from + m.to + (m.promotion || '');
  const expected = p.solution[P.step];
  const fenBefore = P.fen;
  P.fen = c.fen();
  board.setPosition(P.fen, { lastMove: [m.from, m.to], check: c.inCheck() ? kingSq(c) : null });
  playForMove(m, c.inCheck());

  let ok = uci === expected || c.isCheckmate();
  if (!ok) {
    // Coup alternatif : on vérifie avec Stockfish s'il est aussi bon.
    P.state = 'checking';
    $('pz-msg').textContent = 'Vérification…';
    const e = await ensureEngine();
    const [before, after] = [await e.analyse(fenBefore, { depth: 14 }), await e.analyse(P.fen, { depth: 14 })];
    if (P.p !== p) return;
    const sb = before.lines[0]?.score, sa = after.lines[0]?.score;
    if (sb && sa) {
      if (isMateFor(sb, p.color)) ok = isMateFor(sa, p.color);
      else ok = moverWin(sa, p.color) >= moverWin(sb, p.color) - 3 && moverWin(sa, p.color) >= 60;
    }
    if (ok) { P.state = 'play'; return finish(true, 'Coup alternatif accepté !'); }
  }
  if (!ok) {
    board.setBadge(to, 'mistake');
    return finish(false);
  }
  board.setBadge(to, 'best');
  P.step++;
  if (P.step >= p.solution.length) return finish(true);
  // réponse adverse
  P.state = 'opponent';
  $('pz-status').className = 'pz-status ok';
  $('pz-msg').innerHTML = `${classIcon('best', 18)} Bon coup ! Continuez…`;
  setTimeout(() => {
    if (P.p !== p) return;
    const r = applyUci(P.fen, p.solution[P.step]);
    P.fen = r.fen;
    P.step++;
    board.setBadge(null);
    board.setPosition(P.fen, { lastMove: [r.m.from, r.m.to], check: r.c.inCheck() ? kingSq(r.c) : null });
    playForMove(r.m, r.c.inCheck());
    P.state = 'play';
    $('pz-status').className = 'pz-status';
    $('pz-msg').textContent = 'À vous : trouvez la suite.';
    if (P.step >= p.solution.length) finish(true);
  }, 450);
}

function kingSq(c) {
  for (const row of c.board()) for (const x of row) if (x && x.type === 'k' && x.color === c.turn()) return x.square;
  return null;
}

async function finish(success, msg) {
  const p = P.p;
  P.state = 'done';
  $('pz-status').className = 'pz-status ' + (success ? 'ok' : 'bad');
  $('pz-msg').innerHTML = success
    ? `${classIcon('best', 20)} <b>${msg || 'Puzzle réussi !'}</b>`
    : `${classIcon('blunder', 20)} <b>Incorrect.</b> Recommencez ou regardez la solution.`;
  play(success ? 'success' : 'error');
  let delta = 0;
  if (!P.counted) {
    P.counted = true;
    const expected = 1 / (1 + Math.pow(10, (p.rating - stats.rating) / 400));
    const k = stats.solved + stats.failed < 20 ? 40 : 20;
    delta = Math.round(k * ((success && P.hint === 0 ? 1 : 0) - expected));
    stats.rating = Math.max(100, stats.rating + delta);
    if (success && P.hint === 0) { stats.solved++; stats.streak++; stats.bestStreak = Math.max(stats.bestStreak, stats.streak); }
    else { stats.failed++; stats.streak = 0; }
    stats.history.push({ id: p.id, ok: success, t: Date.now(), r: Math.round(stats.rating) });
    await savePuzzleStats(stats);
    await updatePuzzle(p.id, { attempts: (p.attempts || 0) + 1, solved: (p.solved || 0) + (success ? 1 : 0), failed: (p.failed || 0) + (success ? 0 : 1) });
    puzzles = await getPuzzles();
    P.p = puzzles.find(x => x.id === p.id) || p;
  }
  renderStats(delta);
  renderGrid();
}

function hint() {
  if (!P.p || P.state !== 'play') return;
  const u = P.p.solution[P.step];
  P.hint++;
  if (P.hint === 1) {
    board.setArrows([]);
    board.userMarks.add(u.slice(0, 2));
    board.drawArrows();
    $('pz-msg').textContent = 'Indice : regardez cette pièce.';
  } else {
    board.setArrows([{ from: u.slice(0, 2), to: u.slice(2, 4), color: 'rgba(129,182,76,.85)' }]);
    $('pz-msg').textContent = 'Indice : jouez ce coup.';
  }
}

async function showSolution() {
  const p = P.p;
  if (!p) return;
  if (!P.counted) await finish(false);
  P.state = 'solution';
  let fen = p.fen;
  board.setPosition(fen, { animate: false });
  for (let i = 0; i < p.solution.length; i++) {
    await new Promise(r => setTimeout(r, 650));
    if (P.p !== p) return;
    const r = applyUci(fen, p.solution[i]);
    fen = r.fen;
    board.setPosition(fen, { lastMove: [r.m.from, r.m.to], check: r.c.inCheck() ? kingSq(r.c) : null });
    if (i % 2 === 0) board.setBadge(r.m.to, 'best');
    playForMove(r.m, r.c.inCheck());
  }
  $('pz-msg').innerHTML = `${classIcon('best', 18)} Solution : ${solutionSan(p).join(' ')}`;
}

function solutionSan(p) {
  const c = new Chess(p.fen);
  const out = [];
  for (const u of p.solution) {
    try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; }
  }
  return out;
}

/* ---------- Génération depuis chess.com ---------- */

async function generate() {
  const user = $('gen-user').value.trim();
  if (!user) return;
  const n = +$('gen-count').value;
  $('btn-gen').disabled = true;
  $('gen-progress').hidden = false;
  const sub = $('gen-sub'), fill = $('gen-fill');
  sub.textContent = 'Récupération des parties…';
  fill.style.width = '0%';
  let found = 0;
  try {
    const games = await fetchRecentGames(user, n);
    const workers = Math.max(1, settings.workers);
    genPool = new EnginePool(workers, 'lite-single', { hash: 16 });
    sub.textContent = 'Chargement de Stockfish…';
    await genPool.init();
    const cfg = { ...settings, username: user, puzzleSide: 'me' };
    for (let gi = 0; gi < games.length && !genPool.cancelled; gi++) {
      const g = games[gi];
      let game;
      try { game = parsePgn(g.pgn); } catch { continue; }
      game.id = g.id; game.gtype = g.gtype;
      const positions = buildPositions(game.startFen, game.moves);
      if (positions.length < 8) continue;
      const evals = await evaluatePositions(positions, genPool, {
        depth: 14, multipv: 2,
        onProgress: (d, t) => {
          fill.style.width = ((gi + d / t) / games.length * 100).toFixed(1) + '%';
          sub.textContent = `Partie ${gi + 1}/${games.length} · position ${d}/${t} · ${found} puzzle(s) trouvé(s)`;
        },
      });
      if (genPool.cancelled) break;
      const res = classifyGame(positions, evals, cfg);
      const pz = extractPuzzles(game, positions, evals, res.moves, cfg);
      found += await addPuzzles(pz);
    }
    sub.textContent = `Terminé : ${found} nouveau(x) puzzle(s).`;
    fill.style.width = '100%';
  } catch (e) {
    sub.textContent = 'Erreur : ' + e.message;
  } finally {
    genPool?.terminate();
    genPool = null;
    $('btn-gen').disabled = false;
    puzzles = await getPuzzles();
    queue = [];
    renderGrid();
    if (!P.p && puzzles.length) start(pickNext());
  }
}

init();
