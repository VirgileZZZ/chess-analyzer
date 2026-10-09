// Analyse d'une partie : évaluation Stockfish de chaque position, classification
// des coups (façon chess.com), précision, performance estimée, phases.
import { Chess } from '../lib/chess.js';
import { OPENINGS } from '../data/openings.js';
import { CLASSES } from './classes.js';
import { frOpening } from './openings-fr.js';

export const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const epd = fen => fen.split(' ').slice(0, 4).join(' ');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ---------- Scores ---------- */

/** Score (point de vue Blancs) -> centipions bornés, les mats deviennent ±10000. */
export function scoreToCp(s) {
  if (!s) return 0;
  if (s.mate != null) {
    if (s.mate === 0) return s.mated === 'w' ? -10000 : 10000;
    return s.mate > 0 ? 10000 - s.mate * 10 : -10000 - s.mate * 10;
  }
  return s.cp;
}

/** Probabilité de gain des Blancs (0..100), formule de Lichess. */
export function winPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function moverWin(score, color) {
  const w = winPct(scoreToCp(score));
  return color === 'w' ? w : 100 - w;
}

export function isMateFor(score, color) {
  if (!score || score.mate == null) return false;
  if (score.mate === 0) return score.mated !== color;
  return color === 'w' ? score.mate > 0 : score.mate < 0;
}

/** Texte d'évaluation façon chess.com : "+1.25", "M3", "-M2". */
export function formatScore(s, { pov = 'w', abs = false } = {}) {
  if (!s) return '…';
  if (s.mate != null) {
    if (s.mate === 0) return s.mated === 'w' ? '0-1' : '1-0';
    const m = pov === 'w' ? s.mate : -s.mate;
    return (m < 0 && !abs ? '-' : '') + 'M' + Math.abs(m);
  }
  const v = (pov === 'w' ? s.cp : -s.cp) / 100;
  if (abs) return Math.abs(v).toFixed(2);
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

/* ---------- Construction de la partie ---------- */

function moveInfo(m) {
  return {
    color: m.color, from: m.from, to: m.to, piece: m.piece, captured: m.captured || null,
    promotion: m.promotion || null, san: m.san, uci: m.from + m.to + (m.promotion || ''),
    flags: m.flags, before: m.before, after: m.after,
  };
}

/**
 * moves : tableau de {from,to,promotion} ou de SAN.
 * Retourne { positions: [{ fen, move, legal, terminal }] } (positions[0] = départ).
 */
export function buildPositions(startFen, moves) {
  const c = new Chess(startFen || undefined);
  const positions = [{ fen: c.fen(), move: null }];
  for (const mv of moves) {
    let m;
    try { m = c.move(mv); } catch { m = null; }
    if (!m) break;
    positions.push({ fen: c.fen(), move: moveInfo(m) });
  }
  for (const p of positions) {
    const t = new Chess(p.fen);
    p.legal = t.moves().length;
    if (t.isCheckmate()) p.terminal = { score: { cp: null, mate: 0, mated: t.turn() } };
    else if (t.isStalemate() || t.isInsufficientMaterial()) p.terminal = { score: { cp: 0, mate: null } };
    p.inCheck = t.inCheck();
  }
  return positions;
}

export function uciToSan(fen, uci) {
  try {
    const c = new Chess(fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m ? m.san : uci;
  } catch { return uci; }
}

/** Convertit une ligne UCI en SAN numérotés. */
export function pvToSan(fen, pv, max = 12) {
  const c = new Chess(fen);
  const out = [];
  for (const u of pv.slice(0, max)) {
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { m = null; }
    if (!m) break;
    out.push({ san: m.san, color: m.color, num: null, uci: u, fenAfter: c.fen() });
  }
  let num = +fen.split(' ')[5] || 1;
  out.forEach((m, i) => {
    m.num = num;
    if (m.color === 'b') num++;
    m.label = m.color === 'w' ? `${m.num}. ${m.san}` : (i === 0 ? `${m.num}… ${m.san}` : m.san);
  });
  return out;
}

/* ---------- Analyse moteur ---------- */

/**
 * Évalue toutes les positions avec le pool de moteurs.
 * onProgress(done, total, evals)
 */
export async function evaluatePositions(positions, pool, { depth, movetime, multipv = 2, onProgress } = {}) {
  const evals = new Array(positions.length);
  let done = 0;
  await pool.run(positions, async (engine, pos, i) => {
    if (pos.terminal) {
      evals[i] = { lines: [{ multipv: 1, depth: 0, score: pos.terminal.score, pv: [] }], depth: 0 };
    } else {
      const res = await engine.analyse(pos.fen, { depth: movetime ? 0 : depth, movetime, multipv });
      evals[i] = { lines: res.lines.map(l => ({ multipv: l.multipv, depth: l.depth, score: l.score, pv: l.pv })), depth: res.depth };
      if (!evals[i].lines.length) evals[i].lines = [{ multipv: 1, depth: 0, score: { cp: 0, mate: null }, pv: res.bestmove ? [res.bestmove] : [] }];
    }
    done++;
    onProgress && onProgress(done, positions.length, evals);
  });
  return evals;
}

/* ---------- Classification ---------- */

const STRICT = { lenient: 1.35, normal: 1, strict: 0.75 };

const SEE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

/** Échange statique (SEE) : gain matériel pour `by` qui capture en premier sur `sq`. */
export function see(c, sq, by, firstValue) {
  const other = by === 'w' ? 'b' : 'w';
  const vals = col => c.attackers(sq, col).map(s => SEE_VAL[c.get(s).type]).sort((a, b) => a - b);
  const lists = [vals(by), vals(other)];
  const i = lists[0].indexOf(firstValue);
  if (i >= 0) lists[0].splice(i, 1);
  const gain = [SEE_VAL[c.get(sq).type]];
  let onSq = firstValue, side = 1, d = 0;
  while (lists[side].length) {
    d++;
    gain[d] = onSq - gain[d - 1];
    onSq = lists[side].shift();
    side ^= 1;
  }
  for (; d > 0; d--) gain[d - 1] = -Math.max(-gain[d - 1], gain[d]);
  return gain[0];
}

/** Détecte un sacrifice : après le coup, l'adversaire peut gagner du matériel net. */
export function isSacrifice(fenAfter, move, { pawnSacs = false } = {}) {
  const c = new Chess(fenAfter);
  const me = move.color;
  let gainedNow = move.captured ? VAL[move.captured] : 0;
  if (move.promotion) gainedNow += VAL[move.promotion] - 1;
  const captures = c.moves({ verbose: true }).filter(m => m.captured);
  if (!captures.length) return false;
  const bySq = {};
  for (const m of captures) (bySq[m.to] ||= []).push(m);
  let best = 0;
  for (const sq in bySq) {
    const piece = c.get(sq);
    if (!piece || piece.color !== me || piece.type === 'k') continue;
    if (piece.type === 'p' && !pawnSacs) continue;
    const first = Math.min(...bySq[sq].map(m => SEE_VAL[m.piece]));
    best = Math.max(best, see(c, sq, c.turn(), first));
  }
  return best - gainedNow >= 1 && best >= 2;
}

function balance(fen, color) {
  let b = 0;
  for (const ch of fen.split(' ')[0]) {
    const t = ch.toLowerCase();
    if (!(t in VAL)) continue;
    b += (ch === t ? -1 : 1) * VAL[t];
  }
  return color === 'w' ? b : -b;
}

/** Joue `plies` demi-coups d'une ligne (prolonge tant que des captures sont en cours). */
function playLine(fen, pv, plies) {
  const c = new Chess(fen);
  let k = 0, lastCapture = false;
  for (const u of pv) {
    if (k >= plies && !(lastCapture && k < plies + 3)) break;
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { m = null; }
    if (!m) break;
    lastCapture = !!m.captured;
    k++;
  }
  return c.fen();
}

/**
 * Matériel perdu par `color` à cause du coup joué : compare la ligne du moteur après le coup
 * (2 coups complets) à la position avant le coup ET à la ligne du meilleur coup.
 */
export function materialLost(fenBefore, fenAfter, pvAfter, pvBest, color) {
  const before = balance(fenBefore, color);
  const played = balance(playLine(fenAfter, pvAfter, 4), color);
  const best = pvBest?.length ? balance(playLine(fenBefore, pvBest, 5), color) : before;
  return Math.min(before - played, best - played);
}

function materialNonPawn(fen) {
  let n = 0, queens = 0;
  for (const ch of fen.split(' ')[0]) {
    const t = ch.toLowerCase();
    if ('nbrq'.includes(t)) n += VAL[t];
    if (t === 'q') queens++;
  }
  return { n, queens };
}

function phaseOf(fen, ply, inBook) {
  const { n, queens } = materialNonPawn(fen);
  if (n <= 26 || (queens === 0 && n <= 36)) return 'endgame';
  if (inBook || (ply <= 20 && n >= 52)) return 'opening';
  return 'middlegame';
}

export function moveAccuracy(winBefore, winAfter) {
  const d = Math.max(0, winBefore - winAfter);
  return clamp(103.1668 * Math.exp(-0.04354 * d) - 3.1669 + 1, 0, 100);
}

function stddev(a) {
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

const ELO_TABLE = [[0, 100], [40, 250], [50, 400], [60, 600], [70, 900], [75, 1100], [80, 1350], [85, 1650], [90, 2000], [93, 2300], [96, 2650], [98, 2900], [100, 3200]];
export function accuracyToElo(acc) {
  for (let i = 1; i < ELO_TABLE.length; i++) {
    const [a1, e1] = ELO_TABLE[i - 1], [a2, e2] = ELO_TABLE[i];
    if (acc <= a2) return Math.round(e1 + (e2 - e1) * (acc - a1) / (a2 - a1));
  }
  return 3200;
}

export function phaseIcon(acc) {
  if (acc == null) return null;
  if (acc >= 90) return 'best';
  if (acc >= 80) return 'excellent';
  if (acc >= 70) return 'good';
  if (acc >= 55) return 'inaccuracy';
  if (acc >= 40) return 'mistake';
  return 'blunder';
}

/**
 * Classe chaque coup et calcule les statistiques de la partie.
 * Retourne { moves: [annotation par coup (index = ply, 1..N)], summary }.
 */
export function classifyGame(positions, evals, settings = {}) {
  const f = STRICT[settings.strictness] || 1;
  const T = { excellent: 2 * f, good: 5 * f, inaccuracy: 10 * f, mistake: 20 * f };
  const N = positions.length - 1;
  const ann = new Array(N + 1).fill(null);
  let inBook = settings.enableBook !== false;
  let opening = null;

  for (let i = 1; i <= N; i++) {
    const pos = positions[i], prevPos = positions[i - 1];
    const mv = pos.move, color = mv.color;
    const prev = evals[i - 1], cur = evals[i];
    const bestLine = prev.lines[0];
    const bestUci = bestLine?.pv[0] || null;
    const match = prev.lines.find(l => l.pv[0] === mv.uci);
    const scoreAfter = match && match.depth >= (cur.lines[0]?.depth || 0) - 2 ? match.score : cur.lines[0].score;
    const winBefore = moverWin(bestLine.score, color);
    const winAfter = moverWin(scoreAfter, color);
    const loss = Math.max(0, winBefore - winAfter);
    const isBest = mv.uci === bestUci;
    const a = {
      ply: i, color, san: mv.san, uci: mv.uci, from: mv.from, to: mv.to,
      bestUci, bestSan: bestUci ? uciToSan(prevPos.fen, bestUci) : null,
      scoreBefore: bestLine.score, scoreAfter: cur.lines[0].score,
      winBefore, winAfter, loss, isBest,
      accuracy: moveAccuracy(winBefore, winAfter),
      cls: null, opening: null, notes: [],
    };

    // Théorie
    const key = epd(pos.fen);
    if (inBook && i <= 40 && key in OPENINGS) {
      if (OPENINGS[key]) { const [eco, nm] = OPENINGS[key].split('|'); opening = eco + '|' + frOpening(nm); }
      a.cls = 'book';
      a.accuracy = 100;
    } else inBook = false;
    a.opening = opening;

    if (!a.cls && prevPos.legal === 1) a.cls = 'forced';

    if (!a.cls) {
      let cls;
      if (isBest || loss < 0.3) cls = 'best';
      else if (loss < T.excellent) cls = 'excellent';
      else if (loss < T.good) cls = 'good';
      else if (loss < T.inaccuracy) cls = 'inaccuracy';
      else if (loss < T.mistake) cls = 'mistake';
      else cls = 'blunder';

      // Une gaffe (??) = perte de matériel (ou mat autorisé) dans les 2 coups qui suivent.
      // Sinon, une grosse perte purement positionnelle reste une « erreur » (?).
      if (cls === 'blunder' && settings.blunderNeedsMaterial !== false) {
        const opp = color === 'w' ? 'b' : 'w';
        if (!isMateFor(cur.lines[0].score, opp)) {
          const lost = materialLost(prevPos.fen, pos.fen, cur.lines[0].pv, bestLine.pv, color);
          if (lost < 1) cls = 'mistake';
          else a.notes.push('material');
        }
      }

      // Brillant : bon coup qui sacrifie du matériel sans compromettre la position.
      if (settings.enableBrilliant !== false && (cls === 'best' || (cls === 'excellent' && loss < 1.5))
          && winAfter >= 45 && (winBefore < 99.5 || isMateFor(scoreAfter, color)) && isSacrifice(pos.fen, mv, { pawnSacs: settings.brilliantPawnSacs })) {
        cls = 'brilliant';
        a.notes.push('sacrifice');
      }

      // Très bon coup : le seul coup qui garde le résultat (gros écart avec la 2e ligne).
      if (cls === 'best' && isBest && settings.enableGreat !== false && prev.lines[1] && prevPos.legal > 1) {
        const second = moverWin(prev.lines[1].score, color);
        const prevMove = prevPos.move;
        const recapture = prevMove && prevMove.captured && prevMove.to === mv.to;
        if (winBefore - second >= 12 / f && second < 75 && !recapture && !pos.terminal) {
          cls = 'great';
          a.notes.push('only');
        }
      }

      // Occasion manquée : l'adversaire venait de se tromper et on n'en profite pas.
      if (settings.enableMiss !== false && ['inaccuracy', 'mistake', 'blunder'].includes(cls)) {
        const missedMate = isMateFor(bestLine.score, color) && !isMateFor(scoreAfter, color) && winAfter >= 50;
        let missed = false;
        if (i >= 2) {
          const before2 = moverWin(evals[i - 2].lines[0].score, color);
          missed = winBefore >= 60 && winBefore - before2 >= 10 && winAfter >= before2 - 3;
        }
        if (missed || missedMate) {
          cls = 'miss';
          if (missedMate) a.notes.push('missedMate');
        }
      }
      a.cls = cls;
    }
    ann[i] = a;
  }

  // Précision façon Lichess (moyenne pondérée par la volatilité + moyenne harmonique)
  const wins = evals.map(e => winPct(scoreToCp(e.lines[0].score)));
  const ws = clamp(Math.floor(N / 10), 2, 8);
  const windows = [];
  for (let k = 0; k < ws - 2; k++) windows.push(wins.slice(0, ws));
  for (let k = 0; k + ws <= wins.length; k++) windows.push(wins.slice(k, k + ws));
  const weights = windows.map(w => clamp(stddev(w), 0.5, 12));

  const players = { w: newStats(), b: newStats() };
  for (let i = 1; i <= N; i++) {
    const a = ann[i], s = players[a.color];
    s.counts[a.cls] = (s.counts[a.cls] || 0) + 1;
    const w = weights[i - 1] ?? 1;
    s.wsum += a.accuracy * w; s.w += w;
    s.hsum += 1 / Math.max(a.accuracy, 1); s.n++;
    s.cpl += Math.min(1000, Math.max(0, (a.color === 'w' ? 1 : -1) * (scoreToCp(a.scoreBefore) - scoreToCp(a.scoreAfter))));
    const ph = phaseOf(positions[i - 1].fen, i, a.cls === 'book');
    a.phase = ph;
    (s.phases[ph] ||= []).push(a.accuracy);
  }
  for (const c of ['w', 'b']) {
    const s = players[c];
    if (!s.n) { s.accuracy = null; continue; }
    const weighted = s.wsum / s.w, harmonic = s.n / s.hsum;
    s.accuracy = clamp((weighted + harmonic) / 2, 0, 100);
    s.acpl = Math.round(s.cpl / s.n);
    s.elo = accuracyToElo(s.accuracy);
    s.phaseIcons = {};
    for (const ph of ['opening', 'middlegame', 'endgame']) {
      const arr = s.phases[ph];
      s.phaseIcons[ph] = arr && arr.length ? phaseIcon(arr.reduce((x, y) => x + y, 0) / arr.length) : null;
    }
    delete s.wsum; delete s.w; delete s.hsum; delete s.cpl;
  }
  const lastOpening = ann.filter(Boolean).map(a => a.opening).filter(Boolean).pop() || null;
  return { moves: ann, summary: { players, opening: lastOpening } };
}

function newStats() {
  return { counts: {}, wsum: 0, w: 0, hsum: 0, n: 0, cpl: 0, phases: {} };
}

/* ---------- Commentaires du coach ---------- */

function evalPhrase(score) {
  if (score.mate === 0) return 'Échec et mat !';
  const cp = scoreToCp(score);
  if (score.mate != null && score.mate !== 0) return score.mate > 0 ? `Les Blancs ont un mat en ${score.mate}.` : `Les Noirs ont un mat en ${-score.mate}.`;
  const a = Math.abs(cp), side = cp > 0 ? 'Les Blancs' : 'Les Noirs';
  if (a < 40) return 'La position est équilibrée.';
  if (a < 100) return `${side} sont légèrement mieux.`;
  if (a < 250) return `${side} ont l'avantage.`;
  return `${side} ont un avantage décisif.`;
}

/** Génère le texte du coach pour un coup annoté. */
export function explain(a, positions, evals) {
  if (!a) return { title: 'Position de départ', text: 'Utilisez les flèches pour parcourir la partie.' };
  const C = CLASSES[a.cls];
  const title = `${a.san} ${C.text}`;
  const parts = [];
  const prevFen = positions[a.ply - 1].fen;
  switch (a.cls) {
    case 'book':
      parts.push(a.opening ? `Théorie : ${a.opening.split('|')[1]}.` : 'Un coup connu de la théorie des ouvertures.');
      break;
    case 'brilliant':
      parts.push('Un sacrifice audacieux qui fonctionne !');
      break;
    case 'great':
      parts.push(a.winAfter >= 60 ? "Le seul coup qui conserve l'avantage." : a.winAfter >= 40 ? "Le seul coup qui maintient l'équilibre." : 'Le seul coup qui garde des chances de se défendre.');
      break;
    case 'forced':
      parts.push("C'était le seul coup légal.");
      break;
    case 'best':
      break;
    default: {
      if (a.bestSan && !a.isBest) parts.push(`Le meilleur coup était ${a.bestSan}.`);
      if (a.cls === 'miss') {
        if (a.notes.includes('missedMate')) {
          const m = Math.abs(a.scoreBefore.mate);
          parts.push(`Il y avait un mat en ${m} !`);
        } else parts.push("Vous n'avez pas profité de l'erreur de l'adversaire.");
      }
      if (['inaccuracy', 'mistake', 'blunder'].includes(a.cls)) {
        const opp = a.color === 'w' ? 'b' : 'w';
        if (isMateFor(a.scoreAfter, opp)) {
          parts.push(`Cela permet un mat en ${Math.abs(a.scoreAfter.mate)}.`);
        } else {
          const reply = evals[a.ply].lines[0]?.pv[0];
          if (reply) {
            const c = new Chess(positions[a.ply].fen);
            let m = null;
            try { m = c.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] }); } catch {}
            if (m && m.captured && VAL[m.captured] >= 3) parts.push(`Après ${m.san}, vous perdez du matériel.`);
            else if (m && a.cls !== 'inaccuracy') parts.push(`L'adversaire peut répondre ${m.san}.`);
          }
        }
      }
    }
  }
  parts.push(evalPhrase(a.scoreAfter));
  return { title, text: parts.join(' ') };
}

/* ---------- Puzzles ---------- */

const CLASS_RANK = { inaccuracy: 1, mistake: 2, miss: 2, blunder: 3 };

/** Extrait des puzzles des erreurs de la partie. */
export function extractPuzzles(game, positions, evals, annotations, settings) {
  const out = [];
  const minRank = CLASS_RANK[settings.puzzleMinClass] || 2;
  const me = (settings.username || '').toLowerCase();
  for (const a of annotations) {
    if (!a || !(CLASS_RANK[a.cls] >= minRank)) continue;
    if (settings.puzzleSide === 'me' && me) {
      const name = ((a.color === 'w' ? game.white?.name : game.black?.name) || '').toLowerCase();
      if (name !== me) continue;
    }
    const prev = evals[a.ply - 1];
    const best = prev.lines[0];
    if (!best || best.pv.length === 0) continue;
    const second = prev.lines[1];
    const bestWin = moverWin(best.score, a.color);
    const secondWin = second ? moverWin(second.score, a.color) : 0;
    const mate = isMateFor(best.score, a.color) ? Math.abs(best.score.mate) : 0;
    if (!mate && (bestWin < 55 || bestWin - secondWin < 8)) continue;
    let len = mate && mate <= 4 ? mate * 2 - 1 : Math.min(3, best.pv.length);
    len = Math.min(len, best.pv.length);
    if (len % 2 === 0) len--;
    const fen = positions[a.ply - 1].fen;
    out.push({
      id: `${game.id || 'pgn'}-${a.ply}`,
      fen,
      solution: best.pv.slice(0, len),
      color: a.color,
      mate,
      theme: mate ? `Mat en ${mate}` : (a.cls === 'miss' ? 'Occasion manquée' : 'Meilleur coup'),
      playedSan: a.san,
      bestScore: best.score,
      rating: estimatePuzzleRating(a, game),
      source: { gameId: game.id, gtype: game.gtype, white: game.white?.name, black: game.black?.name, date: game.date, ply: a.ply },
      created: Date.now(),
      attempts: 0, solved: 0, failed: 0,
    });
  }
  return out;
}

function estimatePuzzleRating(a, game) {
  const r = (a.color === 'w' ? game.white?.rating : game.black?.rating) || 1200;
  const bonus = { blunder: -150, mistake: 0, miss: 100, inaccuracy: 150 }[a.cls] || 0;
  return Math.max(400, Math.round(+r + bonus));
}
