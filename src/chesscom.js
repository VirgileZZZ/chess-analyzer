// Récupération des parties chess.com (API "callback" + API publique) et PGN.
import { Chess } from '../lib/chess.js';

const TCN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?{~}(^)[_]@#$,./&-*++=';

/** Décode la notation compacte TCN utilisée par chess.com. */
export function decodeTCN(s) {
  const out = [];
  for (let i = 0; i + 1 < s.length; i += 2) {
    const m = {};
    const a = TCN.indexOf(s[i]);
    let b = TCN.indexOf(s[i + 1]);
    if (b > 63) {
      m.promotion = 'qnrbkp'[Math.floor((b - 64) / 3)];
      b = a + (a < 16 ? -8 : 8) + ((b - 1) % 3) - 1;
    }
    if (a > 75) m.drop = 'qnrbkp'[a - 79];
    else m.from = TCN[a % 8] + (Math.floor(a / 8) + 1);
    m.to = TCN[b % 8] + (Math.floor(b / 8) + 1);
    out.push(m);
  }
  return out;
}

export function parseGameUrl(url) {
  const m = /\/(?:game\/(live|daily)\/|(live|daily)\/game\/|analysis\/game\/(live|daily)\/|game\/)(\d+)/.exec(url || '');
  if (!m) return null;
  return { gtype: m[1] || m[2] || m[3] || 'live', id: m[4] };
}

async function getJson(url) {
  const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} (${url})`);
  return r.json();
}

/** Normalise les coups TCN en coups jouables par chess.js (gère le roque roi→tour). */
function tcnToMoves(startFen, tcn) {
  const c = new Chess(startFen || undefined);
  const moves = [];
  for (const m of decodeTCN(tcn)) {
    if (m.drop) break;
    let mv = null;
    try { mv = c.move({ from: m.from, to: m.to, promotion: m.promotion }); } catch {}
    if (!mv) {
      const p = c.get(m.from);
      if (p && p.type === 'k') {
        const rank = m.from[1];
        const to = m.to[0] > m.from[0] ? 'g' + rank : 'c' + rank;
        try { mv = c.move({ from: m.from, to }); } catch {}
      }
    }
    if (!mv) break;
    moves.push({ from: mv.from, to: mv.to, promotion: mv.promotion });
  }
  return moves;
}

export async function fetchChessComGame(id, gtype = 'live') {
  const order = gtype === 'daily' ? ['daily', 'live'] : ['live', 'daily'];
  let data = null, type = null, lastErr = null;
  for (const t of order) {
    try {
      data = await getJson(`https://www.chess.com/callback/${t}/game/${id}`);
      if (data?.game?.moveList != null) { type = t; break; }
    } catch (e) { lastErr = e; }
    data = null;
  }
  if (!data) throw lastErr || new Error('Partie introuvable');
  const g = data.game, h = g.pgnHeaders || {};
  if (g.typeName && !/^chess$|standard/i.test(g.typeName) && g.typeName !== 'chess') {
    console.warn('Variante non standard :', g.typeName);
  }
  const startFen = h.SetUp === '1' && h.FEN ? h.FEN : g.initialSetup || undefined;
  const players = data.players || {};
  const byColor = {};
  for (const k of ['top', 'bottom']) {
    const p = players[k];
    if (p) byColor[p.color === 'white' ? 'w' : 'b'] = p;
  }
  const mk = (c, name, elo) => ({
    name: byColor[c]?.username || name || (c === 'w' ? 'Blancs' : 'Noirs'),
    rating: byColor[c]?.rating || elo || null,
    avatar: byColor[c]?.avatarUrl || null,
    country: byColor[c]?.countryName || null,
  });
  const clocks = g.moveTimestamps ? String(g.moveTimestamps).split(',').map(x => +x / 10) : null;
  return {
    id: String(id), gtype: type, source: 'chesscom',
    url: `https://www.chess.com/game/${type}/${id}`,
    startFen: startFen || undefined,
    moves: tcnToMoves(startFen, g.moveList || ''),
    clocks,
    white: mk('w', h.White, h.WhiteElo),
    black: mk('b', h.Black, h.BlackElo),
    result: h.Result || '*',
    termination: h.Termination || g.resultMessage || '',
    date: h.Date || '',
    timeControl: h.TimeControl || '',
    event: h.Event || '',
  };
}

/** Lit un PGN (ou une FEN seule) et renvoie un objet partie normalisé. */
export function parsePgn(text) {
  text = text.trim();
  // FEN seule ?
  if (/^[rnbqkpRNBQKP1-8]+(\/[rnbqkpRNBQKP1-8]+){7}\s+[wb]/.test(text)) {
    new Chess(text); // valide (lève une erreur sinon)
    return { id: null, source: 'fen', startFen: text, moves: [], clocks: null, white: { name: 'Blancs' }, black: { name: 'Noirs' }, result: '*' };
  }
  // Normalise : en-têtes sur leurs lignes, puis une ligne vide avant les coups.
  const HDR = /\[\s*\w+\s+"[^"]*"\s*\]/g;
  const headers = text.match(HDR) || [];
  const movetext = text.replace(HDR, ' ').replace(/\r/g, '').trim();
  text = (headers.length ? headers.join('\n') + '\n\n' : '') + movetext;
  const c = new Chess();
  c.loadPgn(text);
  const h = c.getHeaders();
  const hist = c.history({ verbose: true });
  const startFen = h.FEN || (hist[0] ? hist[0].before : undefined);
  const clocks = [];
  const re = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g;
  let m;
  while ((m = re.exec(text))) clocks.push(+m[1] * 3600 + +m[2] * 60 + +m[3]);
  const link = parseGameUrl(h.Link || h.Site || '');
  return {
    id: link?.id || null, gtype: link?.gtype, source: 'pgn',
    url: h.Link || null,
    startFen,
    moves: hist.map(x => ({ from: x.from, to: x.to, promotion: x.promotion })),
    clocks: clocks.length >= hist.length - 1 ? clocks : null,
    white: { name: h.White || 'Blancs', rating: +h.WhiteElo || null },
    black: { name: h.Black || 'Noirs', rating: +h.BlackElo || null },
    result: h.Result || '*',
    termination: h.Termination || '',
    date: h.Date || h.UTCDate || '',
    timeControl: h.TimeControl || '',
    event: h.Event || '',
  };
}

/** Dernières parties d'un joueur via l'API publique (api.chess.com). */
export async function fetchRecentGames(username, limit = 30) {
  const u = encodeURIComponent(username.trim().toLowerCase());
  const { archives = [] } = await getJson(`https://api.chess.com/pub/player/${u}/games/archives`);
  const games = [];
  for (let i = archives.length - 1; i >= 0 && games.length < limit; i--) {
    const { games: g = [] } = await getJson(archives[i]);
    games.push(...g.filter(x => x.rules === 'chess').reverse());
  }
  return games.slice(0, limit).map(g => {
    const link = parseGameUrl(g.url);
    return {
      id: link?.id, gtype: link?.gtype || 'live', url: g.url, pgn: g.pgn,
      white: g.white, black: g.black, timeClass: g.time_class, end: g.end_time * 1000,
      accuracies: g.accuracies || null,
    };
  });
}

/** Charge un avatar en blob (nécessaire avec l'isolation cross-origin de la page). */
export async function avatarBlobUrl(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return URL.createObjectURL(await r.blob());
  } catch { return null; }
}
