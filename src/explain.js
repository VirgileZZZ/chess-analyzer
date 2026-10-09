// Explications détaillées des coups — analyse concrète de la position (sans IA) :
// motifs tactiques, menaces, matériel gagné/perdu dans la ligne du moteur, idées stratégiques.
import { Chess } from '../lib/chess.js';
import { CLASSES } from './classes.js';
import { see, scoreToCp, isMateFor, moverWin } from './analysis.js';

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAME = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
const LE = { p: 'le pion', n: 'le cavalier', b: 'le fou', r: 'la tour', q: 'la dame', k: 'le roi' };
const UN = { p: 'un pion', n: 'un cavalier', b: 'un fou', r: 'une tour', q: 'la dame', k: 'le roi' };
const SIDE = { w: 'les Blancs', b: 'les Noirs' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const other = c => c === 'w' ? 'b' : 'w';
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const FILES = 'abcdefgh';

/* ------------------------------------------------------------ utilitaires */

function play(fen, uci) {
  const c = new Chess(fen);
  let m = null;
  try { m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch {}
  return m ? { c, m } : null;
}

function pieceLabel(p, sq) { return `${LE[p.type]} ${sq}`; }

function balance(c, color) {
  let b = 0;
  for (const row of c.board()) for (const x of row) if (x && x.type !== 'k') b += (x.color === color ? 1 : -1) * VAL[x.type];
  return b;
}

function materialWord(v) {
  if (v >= 8) return 'la dame';
  if (v >= 5) return 'une tour';
  if (v >= 3) return 'une pièce';
  if (v === 2) return 'deux pions';
  return 'un pion';
}

/** Joue une ligne et renvoie l'évolution du matériel pour `color` (prolonge si une capture est en cours). */
function lineOutcome(fen, pv, plies, color) {
  const c = new Chess(fen);
  const start = balance(c, color);
  const deltas = [0];
  let k = 0, lastCap = false, mate = false;
  for (const u of pv) {
    if (k >= plies && !(lastCap && k < plies + 3)) break;
    let m = null;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch {}
    if (!m) break;
    lastCap = !!m.captured;
    k++;
    deltas.push(balance(c, color) - start);
    if (c.isCheckmate()) { mate = true; break; }
  }
  // valeur « stable » : on ne compte un gain (ou une perte) que s'il tient sur les deux derniers demi-coups
  const a = deltas[deltas.length - 1], b = deltas[Math.max(0, deltas.length - 2)];
  const delta = a > 0 ? Math.min(a, b) : a < 0 ? Math.max(a, b) : 0;
  return { delta: mate ? a : delta, mate, plies: k };
}

function nullMove(fen) {
  const p = fen.split(' ');
  p[1] = p[1] === 'w' ? 'b' : 'w';
  p[3] = '-';
  return p.join(' ');
}

function kingSquare(c, color) {
  for (const row of c.board()) for (const x of row) if (x && x.type === 'k' && x.color === color) return x.square;
  return null;
}

/** Pièces adverses attaquées par la pièce posée en `sq`. */
function attackedTargets(c, sq, color) {
  const out = [];
  for (const row of c.board()) for (const x of row) {
    if (!x || x.color === color) continue;
    if (c.attackers(x.square, color).includes(sq)) out.push(x);
  }
  return out;
}

/** Ce que le camp `color` menace s'il pouvait rejouer (mat en 1 ou gain de matériel). */
export function threatsOf(fen, color) {
  const c0 = new Chess(fen);
  if (c0.turn() !== color) {
    if (c0.inCheck()) return null; // l'échec est déjà la menace
    let c;
    try { c = new Chess(nullMove(fen)); } catch { return null; }
    return bestThreat(c, color);
  }
  return bestThreat(c0, color);
}

function bestThreat(c, color) {
  let best = null;
  for (const m of c.moves({ verbose: true })) {
    const t = new Chess(c.fen());
    t.move(m);
    if (t.isCheckmate()) return { type: 'mate', san: m.san, uci: m.from + m.to };
  }
  for (const m of c.moves({ verbose: true })) {
    if (!m.captured) continue;
    const gain = see(c, m.to, color, VAL[m.piece]);
    if (gain >= 1 && (!best || gain > best.gain)) best = { type: 'capture', san: m.san, gain, target: { type: m.captured, square: m.to }, uci: m.from + m.to };
  }
  return best;
}

/** Pièces de `color` en prise (que l'adversaire gagnerait au prochain coup). */
function hanging(fen, color) {
  const t = threatsOf(fen, other(color));
  return t && t.type === 'capture' ? t : null;
}

/** Clouage / enfilade créés par une pièce à longue portée posée en `sq`. */
function lineMotif(c, sq, color) {
  const p = c.get(sq);
  if (!p || !'brq'.includes(p.type)) return null;
  const dirs = [];
  if (p.type !== 'b') dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
  if (p.type !== 'r') dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  const f0 = FILES.indexOf(sq[0]), r0 = +sq[1];
  for (const [df, dr] of dirs) {
    let f = f0 + df, r = r0 + dr, first = null;
    while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
      const s = FILES[f] + r;
      const x = c.get(s);
      if (x) {
        if (x.color === color) break;
        if (!first) first = { ...x, square: s };
        else {
          if (first.type === 'p' || (x.type === 'p')) break;
          if (VAL[x.type] > VAL[first.type] && first.type !== 'k') return { type: 'pin', pinned: first, behind: { ...x, square: s }, absolute: x.type === 'k' };
          if (first.type === 'k' || VAL[first.type] > VAL[x.type]) return { type: 'skewer', front: first, behind: { ...x, square: s } };
          break;
        }
      }
      f += df; r += dr;
    }
  }
  return null;
}

/* ------------------------------------------------------------ description d'un coup */

/**
 * Décrit ce que fait un coup (liste de motifs, du plus important au moins important).
 * Chaque motif = { k: clé, txt: phrase sans sujet ("attaque la dame d8") }.
 */
export function describeMove(fenBefore, uci, { prevMove = null, ply = 99 } = {}) {
  const r = play(fenBefore, uci);
  if (!r) return { motifs: [], m: null };
  const { c, m } = r;
  const color = m.color, opp = other(color);
  const motifs = [];
  const add = (k, txt, w) => motifs.push({ k, txt, w });

  if (c.isCheckmate()) { add('mate', 'donne échec et mat', 100); return { motifs, m, c }; }

  // promotion
  if (m.promotion) add('promo', `promeut le pion en ${NAME[m.promotion]}`, 60);

  // captures
  if (m.captured) {
    const recapture = prevMove && prevMove.captured && prevMove.to === m.to;
    const gain = VAL[m.captured] - (c.attackers(m.to, opp).length ? VAL[m.piece] : 0);
    if (recapture) add('recapture', `reprend ${LE[m.captured]} en ${m.to}`, 30);
    else if (gain >= 2 && !c.attackers(m.to, opp).length) add('win', `gagne ${UN[m.captured]} gratuitement`, 55);
    else if (VAL[m.captured] === VAL[m.piece]) add('trade', `échange ${LE[m.piece]} contre ${LE[m.captured]}`, 25);
    else add('capture', `prend ${LE[m.captured]} ${m.to}`, 35);
  }

  // échecs
  if (c.inCheck()) {
    const k = kingSquare(c, opp);
    const checkers = c.attackers(k, color);
    if (checkers.length >= 2) add('double', 'donne un échec double', 70);
    else if (checkers.length && checkers[0] !== m.to) add('disco', `donne un échec à la découverte avec ${LE[c.get(checkers[0]).type]}`, 65);
    else add('check', 'donne échec', 20);
  }

  // fourchette / attaques
  const targets = attackedTargets(c, m.to, color).filter(t => t.type !== 'p' || !c.attackers(t.square, opp).length);
  const valuable = targets.filter(t => t.type === 'k' || VAL[t.type] > VAL[m.piece] || (!c.attackers(t.square, opp).length && VAL[t.type] >= 3));
  const caps = c.moves({ verbose: true }).filter(x => x.to === m.to);
  const safe = !caps.length || see(c, m.to, opp, Math.min(...caps.map(x => VAL[x.piece]))) <= 0;
  if (valuable.length >= 2) {
    const names = valuable.slice(0, 2).map(t => t.type === 'k' ? 'le roi' : pieceLabel(t, t.square));
    add('fork', `fait une fourchette sur ${names.join(' et ')}`, safe ? 75 : 40);
  } else if (valuable.length === 1 && valuable[0].type !== 'k') {
    const t = valuable[0];
    add('attack', `attaque ${pieceLabel(t, t.square)}`, VAL[t.type] >= 5 ? 30 : 18);
  }

  // clouage / enfilade
  const lm = lineMotif(c, m.to, color);
  if (lm?.type === 'pin') add('pin', `cloue ${pieceLabel(lm.pinned, lm.pinned.square)} ${lm.absolute ? 'sur son roi' : 'sur ' + pieceLabel(lm.behind, lm.behind.square)}`, lm.absolute ? 45 : 35);
  if (lm?.type === 'skewer') add('skewer', `fait une enfilade sur ${lm.front.type === 'k' ? 'le roi' : pieceLabel(lm.front, lm.front.square)} et ${pieceLabel(lm.behind, lm.behind.square)}`, 50);

  // menace créée (si l'on rejouait)
  const th = threatsOf(c.fen(), color);
  if (th?.type === 'mate') add('threatmate', `menace mat en ${th.san}`, 58);
  else if (th?.type === 'capture' && th.gain >= 2 && !motifs.some(x => x.k === 'fork' || x.k === 'attack')) add('threat', `menace de gagner ${LE[th.target.type]} ${th.target.square} (${th.san})`, 28);

  // défense d'une pièce menacée
  const before = hanging(fenBefore, color);
  if (before && !hanging(c.fen(), color) && !m.captured) {
    const moved = before.target.square === m.from;
    add('save', moved ? `met ${LE[before.target.type]} à l'abri` : `protège ${LE[before.target.type]} ${before.target.square}`, 32);
  }

  // soutien
  if (m.piece === 'p' && !m.captured) {
    const supported = [];
    for (const row of c.board()) for (const x of row) {
      if (!x || x.color !== color || x.square === m.to || x.type === 'k') continue;
      if (c.attackers(x.square, color).includes(m.to) && !new Chess(fenBefore).attackers(x.square, color).length) supported.push(x);
    }
    const central = supported.find(x => 'cdef'.includes(x.square[0]) && x.type === 'p') || supported[0];
    if (central) add('support', `soutient ${pieceLabel(central, central.square)}`, 16);
  }

  // idées stratégiques
  const fromRank = +m.from[1], toRank = +m.to[1];
  const back = color === 'w' ? 1 : 8;
  if (m.flags.includes('k') || m.flags.includes('q')) add('castle', `roque ${m.flags.includes('k') ? 'côté roi' : 'côté dame'} pour mettre le roi à l'abri et connecter les tours`, 22);
  else if ((m.piece === 'n' || m.piece === 'b') && fromRank === back && ply <= 30) add('develop', `développe ${LE[m.piece]}${centerControl(c, m.to, color)}`, 15);
  else if (m.piece === 'p' && 'de'.includes(m.to[0]) && [4, 5].includes(toRank) && ply <= 24) add('center', 'prend de l\'espace au centre', 14);
  else if (m.piece === 'p' && isPassed(c, m.to, color) && (color === 'w' ? toRank >= 5 : toRank <= 4)) add('passer', `pousse le pion passé vers la promotion`, 26);
  else if (m.piece === 'q' && ply <= 10) add('earlyq', 'sort la dame très tôt', 8);
  else if (m.piece === 'k' && !m.captured) add('king', ply > 50 ? 'active le roi' : 'déplace le roi', 8);
  else if (m.piece === 'r' && openFile(c, m.to[0])) add('openfile', `place la tour sur la colonne ${m.to[0]} ouverte`, 14);
  else if (m.piece !== 'p' && m.piece !== 'k' && (color === 'w' ? toRank < fromRank : toRank > fromRank) && !m.captured) add('retreat', `recule ${LE[m.piece]}`, 6);
  else if (m.piece !== 'p' && m.piece !== 'k') add('improve', `repositionne ${LE[m.piece]} en ${m.to}`, 5);

  // affaiblissement du roque
  const ks = kingSquare(c, color);
  if (m.piece === 'p' && ks && Math.abs(FILES.indexOf(m.from[0]) - FILES.indexOf(ks[0])) <= 1 && 'fghabc'.includes(m.from[0]) && Math.abs(+ks[1] - back) <= 1 && ply > 12) {
    add('weaken', 'avance un pion devant son propre roi', 9);
  }

  motifs.sort((a, b) => b.w - a.w);
  // on retire les motifs « de remplissage » s'il y a mieux à dire, et les doublons de cible
  const strong = motifs.some(x => x.w >= 15);
  const seen = new Set();
  const clean = motifs.filter(x => {
    if (strong && x.w < 10) return false;
    const key = (x.txt.match(/[a-h][1-8]/g) || []).join();
    if (key && ['attack', 'threat'].includes(x.k) && seen.has(key)) return false;
    if (key) seen.add(key);
    return true;
  });
  return { motifs: clean, m, c };
}

/* ------------------------------------------------------------ facteurs positionnels */

function features(fen, color) {
  const c = new Chess(fen);
  let cc = c;
  if (c.turn() !== color) { try { cc = new Chess(nullMove(fen)); } catch { cc = null; } }
  const mobility = cc ? cc.moves().length : 0;
  const center = ['d4', 'e4', 'd5', 'e5'].reduce((n, s) => n + c.attackers(s, color).length, 0);
  const back = color === 'w' ? '1' : '8';
  let developed = 0;
  for (const row of c.board()) for (const x of row) if (x && x.color === color && (x.type === 'n' || x.type === 'b') && x.square[1] !== back) developed++;
  const k = kingSquare(c, color);
  const castled = !!k && k[1] === back && 'abcgh'.includes(k[0]);
  return { mobility, center, developed, castled };
}

/** Explique en quoi la position après `fenA` est meilleure qu'après `fenB` pour `color`. */
function positionalEdge(fenA, fenB, color, ply) {
  const A = features(fenA, color), B = features(fenB, color);
  const out = [];
  if (A.castled && !B.castled && ply < 40) out.push('met le roi en sécurité');
  if (A.developed > B.developed && ply < 30) out.push('développe une pièce de plus');
  if (A.center - B.center >= 2) out.push('contrôle mieux le centre');
  if (A.mobility - B.mobility >= 6) out.push(`donne plus d'activité à vos pièces (${A.mobility} coups possibles contre ${B.mobility})`);
  return out;
}

function centerControl(c, sq, color) {
  const center = ['d4', 'e4', 'd5', 'e5'];
  const n = center.filter(s => c.attackers(s, color).includes(sq)).length;
  return n ? ' vers le centre' : '';
}

function isPassed(c, sq, color) {
  const f = FILES.indexOf(sq[0]), r = +sq[1];
  for (let df = -1; df <= 1; df++) {
    const ff = f + df;
    if (ff < 0 || ff > 7) continue;
    for (let rr = color === 'w' ? r + 1 : r - 1; color === 'w' ? rr <= 8 : rr >= 1; rr += color === 'w' ? 1 : -1) {
      const x = c.get(FILES[ff] + rr);
      if (x && x.type === 'p' && x.color !== color) return false;
    }
  }
  return true;
}

function openFile(c, file) {
  for (let r = 1; r <= 8; r++) { const x = c.get(file + r); if (x && x.type === 'p') return false; }
  return true;
}

function joinMotifs(list, n = 2) {
  const t = list.slice(0, n).map(x => x.txt);
  if (t.length <= 1) return t[0] || '';
  return t.slice(0, -1).join(', ') + ' et ' + t[t.length - 1];
}

/** Ligne du moteur en notation, ex. « 15. Nb5 Qd8 16. Nxc7+ ». */
export function lineText(fen, pv, n = 6) {
  const c = new Chess(fen);
  let num = +fen.split(' ')[5] || 1;
  const out = [];
  pv.slice(0, n).forEach((u, i) => {
    let m = null;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch {}
    if (!m) return;
    out.push(m.color === 'w' ? `${num}. ${m.san}` : (i === 0 ? `${num}… ${m.san}` : m.san));
    if (m.color === 'b') num++;
  });
  return out.join(' ');
}

/* ------------------------------------------------------------ explication complète */

/**
 * Explication riche d'un coup annoté.
 * @returns {{ title, paragraphs: string[] (HTML), line: string|null }}
 */
export function explainRich(a, positions, evals) {
  if (!a) return { title: 'Position de départ', paragraphs: ['Utilisez les flèches pour parcourir la partie.'], line: null };
  const C = CLASSES[a.cls];
  const title = `${a.san} ${C.text}`;
  const prevFen = positions[a.ply - 1].fen, fen = positions[a.ply].fen;
  const prevMove = positions[a.ply - 1].move;
  const color = a.color, opp = other(color);
  const me = describeMove(prevFen, a.uci, { prevMove, ply: a.ply });
  const best = a.bestUci && a.bestUci !== a.uci ? describeMove(prevFen, a.bestUci, { prevMove, ply: a.ply }) : null;
  const bestPv = evals[a.ply - 1].lines[0]?.pv || [];
  const replyPv = evals[a.ply].lines[0]?.pv || [];
  const P = [];
  const b = s => `<b>${esc(s)}</b>`;
  const did = joinMotifs(me.motifs);
  const sanB = b(a.san);

  // ---------- ce que fait le coup
  const whatItDoes = did ? `${sanB} ${did}.` : '';

  switch (a.cls) {
    case 'book': {
      const name = a.opening ? a.opening.split('|')[1] : null;
      P.push(`${whatItDoes || sanB + ' est un coup connu.'} ${name ? `On est dans la théorie : ${b(name)}.` : 'C\'est un coup de théorie.'}`);
      P.push(openingIdea(me, a));
      break;
    }
    case 'forced':
      P.push(`C'était le seul coup légal${me.m && me.m.piece === 'k' ? ' pour sortir de l\'échec' : ''}.`);
      break;
    case 'brilliant': {
      const sac = sacrificedPiece(fen, color);
      P.push(`${sanB} ${did || 'est un coup surprenant'}${sac ? ` en laissant ${LE[sac.target.type]} ${sac.target.square} en prise` : ''} !`);
      const takeIt = replyPv[0] ? play(fen, replyPv[0]) : null;
      const out = lineOutcome(fen, replyPv, 6, color);
      if (out.mate) P.push(`Si l'adversaire accepte, la suite ${b(lineText(fen, replyPv, 6))} mène au mat.`);
      else P.push(`Le sacrifice est correct : après ${b(lineText(fen, replyPv, 5))}, ${evalSentence(a.scoreAfter, color)}${out.delta >= 1 ? ` et vous récupérez ${materialWord(out.delta)} de plus` : ''}.`);
      void takeIt;
      break;
    }
    case 'great': {
      P.push(`${whatItDoes || sanB + ' est le coup juste.'}`);
      const second = evals[a.ply - 1].lines[1];
      if (second?.pv?.length) {
        const alt = describeMove(prevFen, second.pv[0], { prevMove, ply: a.ply });
        P.push(`C'était le seul bon coup : l'alternative ${b(alt.m?.san || '?')} ne donnait que ${evalSentence(second.score, color, true)}, contre ${evalSentence(a.scoreAfter, color, true)} ici.`);
      }
      const th = newThreat(prevFen, fen, color, me.motifs);
      if (th) P.push(threatSentence(th, 'Vous menacez maintenant'));
      break;
    }
    case 'best':
    case 'excellent':
    case 'good': {
      P.push(whatItDoes || `${sanB} est un coup solide.`);
      const th = newThreat(prevFen, fen, color, me.motifs);
      if (th) P.push(threatSentence(th, 'Et maintenant, vous menacez'));
      if (best && a.cls !== 'best') {
        const gain = lineOutcome(prevFen, bestPv, 5, color);
        P.push(`Un peu plus précis : ${b(best.m?.san)}${best.motifs.length ? ', qui ' + joinMotifs(best.motifs) : ''}${gain.delta >= 1 ? ` et gagne ${materialWord(gain.delta)}` : ''}.`);
      }
      const oppTh = threatsOf(fen, opp);
      if (oppTh && oppTh.type === 'mate') P.push(`Attention, l'adversaire menace mat avec ${b(oppTh.san)}.`);
      break;
    }
    default: { // imprécision, erreur, occasion manquée, gaffe
      // 1) ce que fait le coup
      if (did) P.push(`${sanB} ${did}${a.cls === 'inaccuracy' ? ', mais ce n\'est pas le plus précis' : ''}.`);
      // 2) le problème
      P.push(problemSentence(a, fen, replyPv, color, b, prevFen));
      // 3) occasion manquée
      if (a.cls === 'miss') {
        const prevErr = positions[a.ply - 1].move;
        P.push(`L'adversaire venait de jouer ${b(prevErr?.san || '…')}, une erreur que vous pouviez punir.`);
      }
      // 4) le meilleur coup et pourquoi
      if (best) {
        const gain = lineOutcome(prevFen, bestPv, 6, color);
        let whyList = best.motifs.filter(x => x.w >= 10).map(x => x.txt);
        if (whyList.length < 2 && best.c) whyList = whyList.concat(positionalEdge(best.c.fen(), fen, color, a.ply).filter(t => !(t.includes('roi') && whyList.some(w => w.includes('roque'))) && !(t.includes('développe') && whyList.some(w => w.includes('développe'))))).slice(0, 2);
        if (!whyList.length) whyList = best.motifs.map(x => x.txt).slice(0, 1);
        let why = whyList.length ? `, qui ${whyList.length > 1 ? whyList.slice(0, -1).join(', ') + ' et ' + whyList[whyList.length - 1] : whyList[0]}` : '';
        if (gain.mate) why += ' et force le mat';
        else if (gain.delta >= 1) why += ` et gagne ${materialWord(gain.delta)}`;
        P.push(`Il fallait jouer ${b(best.m?.san)}${why}. Suite possible : ${b(lineText(prevFen, bestPv, 6))}.`);
      }
    }
  }

  // évaluation finale
  P.push(`${cap(evalSentence(a.scoreAfter, color))}.`);
  return { title, paragraphs: P.filter(Boolean), line: null };
}

function sacrificedPiece(fen, color) {
  const t = threatsOf(fen, other(color));
  return t && t.type === 'capture' ? t : null;
}

/** Menace créée par le coup (absente avant, et pas déjà décrite dans les motifs). */
function newThreat(prevFen, fen, color, motifs) {
  const th = threatsOf(fen, color);
  if (!th) return null;
  if (motifs.some(x => ['threat', 'threatmate', 'fork', 'attack', 'skewer', 'pin'].includes(x.k) && th.target && x.txt.includes(th.target.square))) return null;
  if (motifs.some(x => x.k === 'threatmate') && th.type === 'mate') return null;
  const before = threatsOf(prevFen, color);
  if (before && th.type === before.type && (th.type === 'mate' || before.target?.square === th.target?.square)) return null;
  return th;
}

function threatSentence(th, lead) {
  if (th.type === 'mate') return `${lead} mat avec <b>${esc(th.san)}</b>.`;
  return `${lead} de gagner ${LE[th.target.type]} ${th.target.square} (<b>${esc(th.san)}</b>).`;
}

function problemSentence(a, fen, replyPv, color, b, prevFen) {
  const opp = other(color);
  const sc = a.scoreAfter;
  if (isMateFor(sc, opp) && sc.mate) {
    return `Le problème : cela permet un mat en ${Math.abs(sc.mate)} — ${b(lineText(fen, replyPv, Math.min(9, Math.abs(sc.mate) * 2)))}.`;
  }
  const reply = replyPv[0] ? describeMove(fen, replyPv[0], { prevMove: null, ply: a.ply + 1 }) : null;
  const out = lineOutcome(prevFen, [a.uci, ...replyPv], 6, color);
  const hang = threatsOf(fen, opp);
  if (out.delta <= -1 && reply?.m) {
    const what = reply.motifs.find(x => ['fork', 'pin', 'skewer', 'disco', 'double', 'win', 'capture', 'attack', 'threatmate'].includes(x.k));
    return `Le problème : après ${b(reply.m.san)}${what ? `, qui ${what.txt},` : ''} vous perdez ${materialWord(-out.delta)} (${b(lineText(fen, replyPv, 5))}).`;
  }
  if (hang && hang.type === 'capture' && hang.gain >= 2) {
    return `Le problème : ${LE[hang.target.type]} ${hang.target.square} n'est plus protégé correctement — l'adversaire menace ${b(hang.san)}.`;
  }
  const drop = Math.round(a.loss);
  const strongReply = reply?.motifs.filter(x => x.w >= 15) || [];
  const loss = `environ ${drop} % de chances de gain en moins`;
  if (reply?.m && strongReply.length) {
    return `L'adversaire peut répondre ${b(reply.m.san)}, qui ${joinMotifs(strongReply)} (${b(lineText(fen, replyPv, 4))}) : ${loss}.`;
  }
  return `Ce coup ne perd pas de matériel, mais il ${drop >= 15 ? 'abîme nettement' : 'affaiblit'} votre position (${loss})${reply?.m ? ` ; l'adversaire peut continuer par ${b(reply.m.san)}` : ''}.`;
}

function evalSentence(score, color, short = false) {
  if (!score) return 'la position est floue';
  if (score.mate === 0) return 'c\'est échec et mat';
  if (score.mate != null) {
    const forMe = isMateFor(score, color);
    return forMe ? `vous avez un mat en ${Math.abs(score.mate)}` : `l'adversaire a un mat en ${Math.abs(score.mate)}`;
  }
  const cp = scoreToCp(score) * (color === 'w' ? 1 : -1);
  const v = (Math.abs(cp) / 100).toFixed(1);
  if (short) return `${cp >= 0 ? '+' : '−'}${v}`;
  if (Math.abs(cp) < 35) return `la position est équilibrée (${cp >= 0 ? '+' : '−'}${v})`;
  if (cp > 0) return cp < 120 ? `vous êtes légèrement mieux (+${v})` : cp < 300 ? `vous avez un net avantage (+${v})` : `vous êtes gagnant (+${v})`;
  return cp > -120 ? `l'adversaire est légèrement mieux (−${v})` : cp > -300 ? `l'adversaire a un net avantage (−${v})` : `l'adversaire est gagnant (−${v})`;
}

function openingIdea(me, a) {
  const m = me.m;
  if (!m) return '';
  const ideas = {
    p: ['Les pions centraux libèrent les pièces et gagnent de l\'espace.', 'Ce pion fixe la structure de la partie.'],
    n: ['Les cavaliers se développent vers le centre, où ils contrôlent le plus de cases.', 'Un cavalier bien placé surveille les cases centrales.'],
    b: ['Le fou rejoint le jeu sur une belle diagonale.', 'Le développement du fou prépare le roque.'],
    q: ['La dame entre en jeu, mais attention à ne pas l\'exposer.'],
    r: ['La tour se place sur la colonne qui va s\'ouvrir.'],
    k: ['Le roi se met en sécurité.'],
  };
  const list = ideas[m.piece] || [];
  return list[a.ply % list.length] || '';
}
