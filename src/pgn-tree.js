// Lecture de PGN avec variantes (RAV), commentaires, NAG et annotations
// [%cal]/[%csl] (flèches et cases colorées d'En Croissant / Lichess / ChessBase).
import { Chess } from '../lib/chess.js';

const NAG_SYMBOL = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };
const RESULT = /^(1-0|0-1|1\/2-1\/2|\*)$/;

/** Découpe un fichier contenant une ou plusieurs parties. */
function splitGames(text) {
  text = text.replace(/\r/g, '').replace(/^﻿/, '');
  const games = [];
  let cur = [];
  let inMoves = false;
  for (const line of text.split('\n')) {
    const isHeader = /^\s*\[\w+\s+".*"\]\s*$/.test(line);
    if (isHeader && inMoves) { games.push(cur.join('\n')); cur = []; inMoves = false; }
    if (!isHeader && line.trim()) inMoves = true;
    cur.push(line);
  }
  if (cur.join('').trim()) games.push(cur.join('\n'));
  return games;
}

function tokenize(movetext) {
  const tokens = [];
  let i = 0;
  const s = movetext;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '{') {
      const j = s.indexOf('}', i);
      tokens.push({ t: 'comment', v: s.slice(i + 1, j < 0 ? s.length : j) });
      i = j < 0 ? s.length : j + 1;
    } else if (ch === ';') {
      const j = s.indexOf('\n', i);
      tokens.push({ t: 'comment', v: s.slice(i + 1, j < 0 ? s.length : j) });
      i = j < 0 ? s.length : j + 1;
    } else if (ch === '(') { tokens.push({ t: '(' }); i++; }
    else if (ch === ')') { tokens.push({ t: ')' }); i++; }
    else if (ch === '$') {
      const m = /^\$(\d+)/.exec(s.slice(i));
      tokens.push({ t: 'nag', v: +m[1] });
      i += m[0].length;
    } else {
      const m = /^[^\s{}();]+/.exec(s.slice(i));
      const w = m[0];
      i += w.length;
      if (RESULT.test(w)) continue;
      const stripped = w.replace(/^\d+\.(\.\.)?/, '').replace(/^\d+…/, '');
      if (!stripped || /^\d+\.*$/.test(w)) continue;
      const a = /^(.*?)([!?]{1,2})?$/.exec(stripped);
      tokens.push({ t: 'move', v: a[1], ann: a[2] || '' });
    }
  }
  return tokens;
}

/** Extrait les flèches/cases ([%cal Ge2e4,Rd1d8] [%csl Gd4]) et nettoie le commentaire. */
export function parseComment(raw) {
  const arrows = [], marks = [];
  const colors = { G: 'rgba(129,182,76,.85)', R: 'rgba(235,97,80,.85)', Y: 'rgba(255,170,0,.85)', B: 'rgba(82,176,220,.85)' };
  let text = (raw || '').replace(/\[%cal\s+([^\]]+)\]/g, (_, list) => {
    for (const a of list.split(',')) {
      const m = /^([GRYB])?([a-h][1-8])([a-h][1-8])$/.exec(a.trim());
      if (m) arrows.push({ from: m[2], to: m[3], color: colors[m[1] || 'G'] });
    }
    return '';
  }).replace(/\[%csl\s+([^\]]+)\]/g, (_, list) => {
    for (const a of list.split(',')) {
      const m = /^([GRYB])?([a-h][1-8])$/.exec(a.trim());
      if (m) marks.push({ sq: m[2], color: colors[m[1] || 'R'] });
    }
    return '';
  }).replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  return { text, arrows, marks };
}

/**
 * Lit un PGN et renvoie [{ headers, startFen, root }] où root = { children: [node] }
 * et node = { san, uci, fen, color, ann, comment, arrows, marks, children }.
 */
export function parsePgnTree(text) {
  const out = [];
  for (const g of splitGames(text)) {
    const headers = {};
    const body = g.replace(/^\s*\[(\w+)\s+"(.*)"\]\s*$/gm, (_, k, v) => { headers[k] = v; return ''; });
    const startFen = headers.FEN || new Chess().fen();
    const root = { fen: startFen, children: [], comment: '', arrows: [], marks: [] };
    // pile : { parent, last } ; on construit avec les FEN calculées au fil de l'eau.
    let parent = root, last = null;
    const stack = [];
    let pendingComment = '';
    for (const tk of tokenize(body)) {
      if (tk.t === 'move') {
        const c = new Chess(parent.fen);
        let m = null;
        try { m = c.move(tk.v, { strict: false }); } catch { m = null; }
        if (!m) { last = null; continue; } // coup illisible : on ignore la suite de cette ligne
        let node = parent.children.find(n => n.uci === m.from + m.to + (m.promotion || ''));
        if (!node) {
          node = { san: m.san, uci: m.from + m.to + (m.promotion || ''), from: m.from, to: m.to, color: m.color, fen: c.fen(), ann: tk.ann, comment: '', arrows: [], marks: [], children: [], parent };
          parent.children.push(node);
        } else if (tk.ann && !node.ann) node.ann = tk.ann;
        if (pendingComment) { node.preComment = pendingComment; pendingComment = ''; }
        last = node;
        parent = node;
      } else if (tk.t === 'comment') {
        const pc = parseComment(tk.v);
        const target = last || (stack.length ? null : root);
        if (target) {
          target.comment = [target.comment, pc.text].filter(Boolean).join(' ');
          target.arrows.push(...pc.arrows);
          target.marks.push(...pc.marks);
        } else pendingComment = [pendingComment, pc.text].filter(Boolean).join(' ');
      } else if (tk.t === 'nag') {
        if (last && NAG_SYMBOL[tk.v] && !last.ann) last.ann = NAG_SYMBOL[tk.v];
      } else if (tk.t === '(') {
        stack.push({ parent, last });
        // la variante remplace le dernier coup joué : on repart de son parent
        parent = last ? last.parent : parent;
        last = null;
      } else if (tk.t === ')') {
        const st = stack.pop();
        if (st) { parent = st.parent; last = st.last; }
      }
    }
    out.push({ headers, startFen, root });
  }
  return out;
}
