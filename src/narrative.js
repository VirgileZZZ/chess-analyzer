// Récit de la partie et moments clés — 100 % règles + phrases préécrites (aucune IA).
// Le texte est choisi de façon déterministe (graine = partie) pour varier d'une partie à l'autre
// tout en restant identique à chaque réouverture.
import { Chess } from '../lib/chess.js';
import { CLASSES } from './classes.js';
import { winPct, scoreToCp, formatScore, isMateFor, uciToSan } from './analysis.js';

const PIECE = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
const PIECE_ART = { p: 'un pion', n: 'un cavalier', b: 'un fou', r: 'une tour', q: 'la dame', k: 'le roi' };
const GOOD = new Set(['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced']);
const ERR = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

/* ---------------------------------------------------------------- outils */

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/**
 * Construit le récit.
 * @returns {{ moments: Array, sections: Array<{title, icon, html}>, tips: Array<{icon, html}>, headline: string }}
 */
export function buildNarrative({ game, positions, evals, result, settings }) {
  const N = positions.length - 1;
  if (N < 2 || !evals || !result) return { moments: [], sections: [], tips: [], headline: '' };
  const seed = hashStr((game.id || '') + positions.map(p => p.move?.uci || '').join(''));
  const rand = mulberry(seed);
  const used = new Set();
  // Choisit une phrase au hasard en évitant celles déjà utilisées dans ce récit.
  const pick = arr => {
    const fresh = arr.filter(x => !used.has(x));
    const pool = fresh.length ? fresh : arr;
    const x = pool[Math.floor(rand() * pool.length)];
    used.add(x);
    return x;
  };
  const ann = result.moves;
  const W = evals.map(e => winPct(scoreToCp(e.lines[0].score)));
  const mw = (i, c) => c === 'w' ? W[i] : 100 - W[i];
  const other = c => c === 'w' ? 'b' : 'w';
  const player = c => (c === 'w' ? game.white : game.black) || {};
  const DEFAULT_NAMES = /^(blancs?|noirs?|white|black|\?|)$/i;
  const rawName = c => {
    const n = (player(c).name || '').trim();
    return DEFAULT_NAMES.test(n) ? (c === 'w' ? 'le camp blanc' : 'le camp noir') : n;
  };
  const N_ = c => `<b>${esc(rawName(c))}</b>`;
  const de = c => {
    const n = rawName(c);
    if (n.startsWith('le camp')) return `du <b>${esc(n.slice(3))}</b>`;
    return (/^[aeiouyhâéèêîôûAEIOUYHÉ]/.test(n) ? "d'" : 'de ') + N_(c);
  };
  const colorWord = c => c === 'w' ? 'les Blancs' : 'les Noirs';
  const me = (settings.username || '').toLowerCase();
  const myColor = me && (game.white?.name || '').toLowerCase() === me ? 'w' : me && (game.black?.name || '').toLowerCase() === me ? 'b' : null;

  const moveLabel = ply => {
    const m = positions[ply].move;
    const startNum = +(positions[0].fen.split(' ')[5]) || 1;
    const blackFirst = positions[0].fen.split(' ')[1] === 'b';
    const num = startNum + Math.floor((ply - 1 + (blackFirst ? 1 : 0)) / 2);
    return `${num}${m.color === 'w' ? '.' : '…'} ${m.san}`;
  };
  const moveNum = ply => Math.ceil(ply / 2);
  const ref = (ply, label) => `<span class="mref" data-ply="${ply}">${esc(label || moveLabel(ply))}</span>`;
  const sanRef = (ply, san) => `<span class="mref" data-ply="${ply}" data-alt="1">${esc(san)}</span>`;
  const ev = i => `<span class="evchip ${W[i] >= 50 ? 'w' : 'b'}">${formatScore(evals[i].lines[0].score)}</span>`;

  /* ----- résultat ----- */
  const res = game.result;
  let winner = res === '1-0' ? 'w' : res === '0-1' ? 'b' : res === '1/2-1/2' ? null : undefined;
  if (winner === undefined) winner = W[N] >= 75 ? 'w' : W[N] <= 25 ? 'b' : null;
  const isDraw = res === '1/2-1/2';
  const term = detectTermination(game, positions);

  /* ----- repères ----- */
  let bookEnd = 0;
  for (let i = 1; i <= N; i++) { if (ann[i].cls === 'book') bookEnd = i; else break; }
  const opening = ann.filter(Boolean).map(a => a.opening).filter(Boolean).pop() || null;
  const endgameStart = (ann.find(a => a && a.phase === 'endgame') || {}).ply || null;
  let queensOff = null;
  for (let i = 1; i <= N; i++) {
    const board = positions[i].fen.split(' ')[0];
    if (!board.includes('q') && !board.includes('Q')) {
      if (positions[i - 1].fen.split(' ')[0].match(/[qQ]/)) queensOff = i;
      break;
    }
  }
  const clocks = analyseClocks(game, positions, ann);

  /* ----- conséquence concrète d'une erreur ----- */
  function consequence(i) {
    const a = ann[i], opp = other(a.color);
    if (isMateFor(evals[i].lines[0].score, opp) && evals[i].lines[0].score.mate) {
      return pick([`permet un mat en ${Math.abs(evals[i].lines[0].score.mate)}`, `ouvre la porte à un mat en ${Math.abs(evals[i].lines[0].score.mate)}`, `autorise un mat forcé en ${Math.abs(evals[i].lines[0].score.mate)} coups`]);
    }
    const reply = evals[i].lines[0].pv[0];
    if (!reply) return '';
    try {
      const c = new Chess(positions[i].fen);
      const m = c.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
      if (m.captured && m.captured !== 'p') return pick([`laisse ${PIECE_ART[m.captured]} en prise (${esc(m.san)})`, `perd ${PIECE_ART[m.captured]} après ${esc(m.san)}`, `abandonne ${PIECE_ART[m.captured]} : ${esc(m.san)} suit`]);
      if (m.san.includes('+')) return pick([`expose son roi à ${esc(m.san)}`, `permet l'échec ${esc(m.san)}, très gênant`]);
      return pick([`autorise ${esc(m.san)}`, `permet la réplique ${esc(m.san)}`, `laisse ${esc(m.san)}, très fort`]);
    } catch { return ''; }
  }

  function bestPhrase(a) {
    if (!a.bestSan) return '';
    return pick([
      `Il fallait jouer ${sanRef(a.ply, a.bestSan)}.`,
      `${sanRef(a.ply, a.bestSan)} s'imposait.`,
      `Le bon coup était ${sanRef(a.ply, a.bestSan)}.`,
      `${sanRef(a.ply, a.bestSan)} aurait tout changé.`,
      `Stockfish recommandait ${sanRef(a.ply, a.bestSan)}.`,
    ]);
  }

  function advantageText(i, { short = false } = {}) {
    const w = W[i];
    const lead = w >= 50 ? 'w' : 'b';
    const d = Math.abs(w - 50);
    if (d < 8) return pick(short ? ['équilibre', 'égalité', 'position équilibrée']
      : ['la position était parfaitement équilibrée', 'les chances étaient égales', "rien n'était encore joué", "l'équilibre régnait", 'aucun camp ne se détachait', 'la balance restait au centre']);
    if (d < 20) return fill(pick(['{p} avait un léger avantage', '{p} était légèrement mieux', '{p} exerçait une petite pression', '{p} avait un petit plus', 'la position souriait un peu à {p}']), { p: N_(lead) });
    if (d < 35) return fill(pick(['{p} avait un net avantage', '{p} était clairement mieux', '{p} tenait les commandes', '{p} dominait les débats', 'la position de {p} était nettement préférable']), { p: N_(lead) });
    return fill(pick(['{p} était gagnant', '{p} avait un avantage décisif', '{p} avait la partie en main', 'le sort de la partie penchait nettement vers {p}', '{p} n\'avait plus qu\'à conclure']), { p: N_(lead) });
  }

  /* ======================================================= MOMENTS CLÉS */
  const events = new Map();
  const add = (ply, e) => {
    const cur = events.get(ply);
    if (!cur || e.score > cur.score) events.set(ply, { ...e, ply, tags: [...(cur?.tags || []), e.type] });
    else cur.tags.push(e.type);
  };
  for (let i = 1; i <= N; i++) {
    const a = ann[i];
    if (a.cls === 'brilliant') add(i, { type: 'brilliant', score: 80 });
    if (a.cls === 'great') add(i, { type: 'great', score: 40 + Math.min(20, a.winAfter / 5) });
    if (a.cls === 'blunder') add(i, { type: 'blunder', score: 45 + a.loss });
    if (a.cls === 'mistake') add(i, { type: 'mistake', score: 22 + a.loss });
    if (a.cls === 'miss') add(i, { type: a.notes.includes('missedMate') ? 'missedMate' : 'miss', score: 35 + a.loss + (a.notes.includes('missedMate') ? 25 : 0) });
    if (i > 1 && (W[i - 1] - 50) * (W[i] - 50) < 0 && Math.abs(W[i] - 50) > 15 && Math.abs(W[i - 1] - 50) > 8) add(i, { type: 'lead', score: 30 + Math.abs(W[i] - W[i - 1]) / 2 });
  }
  // point de non-retour
  let decisive = null;
  if (winner) {
    for (let k = N; k >= 1; k--) { if (mw(k, winner) < 80) break; decisive = k; }
    if (decisive && decisive < N - 1) add(decisive, { type: 'decisive', score: 38 });
  }
  if (queensOff) add(queensOff, { type: 'queens', score: 12 });
  if (endgameStart && endgameStart < N - 2) add(endgameStart, { type: 'endgame', score: 10 });
  if (term === 'checkmate') add(N, { type: 'mate', score: 55 });
  if (bookEnd > 0 && bookEnd < N) add(bookEnd + 1, { type: 'outOfBook', score: 6 });

  const selected = [...events.values()].sort((a, b) => b.score - a.score).slice(0, 8).sort((a, b) => a.ply - b.ply);

  const moments = selected.map(e => {
    const a = ann[e.ply];
    const c = a.color, opp = other(c);
    const v = { who: N_(c), opp: N_(opp), move: ref(e.ply), best: a.bestSan ? sanRef(e.ply, a.bestSan) : '', before: ev(e.ply - 1), after: ev(e.ply), deWho: de(c), deOpp: de(opp) };
    let icon = a.cls, title = '', text = '';
    switch (e.type) {
      case 'brilliant':
        title = pick(['Coup brillant !', 'Éclair de génie', 'Sacrifice spectaculaire', 'Un coup de maître']);
        text = fill(pick([
          '{who} sort le grand jeu avec {move} : un sacrifice qui tient parfaitement la route.',
          'Avec {move}, {who} offre du matériel pour un bénéfice bien supérieur. Superbe !',
          '{move} !! — {who} voit plus loin que tout le monde et sacrifie sans hésiter.',
          'Le genre de coup qu\'on n\'oublie pas : {move}, un sacrifice correct signé {who}.',
        ]), v);
        break;
      case 'great':
        title = pick(['Le seul coup', 'Très bon coup', 'Précision chirurgicale', 'Trouvé !']);
        text = fill(pick([
          '{who} trouve {move}, le seul coup qui tient la position. Tout le reste perdait du terrain.',
          'Sous pression, {who} déniche {move}. Aucun autre coup n\'était aussi fort.',
          '{move} : {who} joue l\'unique coup juste dans une position délicate.',
          'Belle découverte de {who} avec {move}, le coup qui fait la différence.',
        ]), v);
        break;
      case 'blunder': {
        title = pick(['Gaffe', 'Le coup qui coûte cher', 'Erreur fatale', 'Faux pas', 'La faute', 'Aïe !', 'Le coup de trop', 'Patatras', 'Grosse bévue', 'Accident', 'La boulette', 'Mauvaise surprise']);
        const cons = consequence(e.ply);
        text = fill(pick([
          '{who} commet une gaffe avec {move}{cons}. L\'évaluation passe de {before} à {after}.',
          'Coup de théâtre : {move} {cons2}. {opp} peut en profiter ({before} → {after}).',
          '{move} ?? — {who} craque{cons}. La position bascule de {before} à {after}.',
          'Avec {move}, {who} {cons2}. Une erreur lourde de conséquences ({before} → {after}).',
          'Moment d\'égarement pour {who} : {move}{consN}. L\'évaluation s\'effondre ({before} → {after}).',
          '{who} ne voit pas le danger : {move}{consN}. {opp} récupère l\'initiative ({after}).',
          'Le genre de coup qu\'on regrette aussitôt : {move} de {who}{consN} ({before} → {after}).',
          '{move} est une grosse bévue{cons}. En un coup, on passe de {before} à {after}.',
          'Accident avec {move} : {who} {cons2} ({before} → {after}).',
          'Tout s\'écroule pour {who} après {move}, qui {cons2} ({before} → {after}).',
        ]), { ...v, cons: cons ? ' et ' + cons : '', consN: cons ? ' — ce coup ' + cons : '', cons2: cons || 'gâche tout' }) + ' ' + bestPhrase(a);
        break;
      }
      case 'mistake': {
        title = pick(['Erreur', 'Imprécision coûteuse', 'Mauvais choix', 'Ça se complique', 'Petit relâchement', 'Mauvaise piste', 'Le doute s\'installe']);
        const cons = consequence(e.ply);
        text = fill(pick([
          '{move} est une erreur de {who}{cons} ({before} → {after}).',
          '{who} se trompe avec {move}{cons}. L\'évaluation glisse de {before} à {after}.',
          'Avec {move}, {who} laisse filer une partie de son avantage ({before} → {after}).',
          '{who} choisit la mauvaise piste avec {move}{cons} ({before} → {after}).',
          '{move} n\'est pas à la hauteur de la position{cons}. {opp} en profite ({after}).',
          'Coup discutable de {who} : {move}{cons}. Évaluation : {before} → {after}.',
        ]), { ...v, cons: cons ? ' — ce coup ' + cons : '' }) + ' ' + bestPhrase(a);
        break;
      }
      case 'miss':
        title = pick(['Occasion manquée', 'L\'occasion était belle', 'Raté !', 'Pas puni', 'La chance passe', 'Impunité']);
        text = fill(pick([
          '{opp} venait de se tromper, mais {who} ne saisit pas sa chance avec {move}. {best} était bien plus fort.',
          '{who} passe à côté de la punition : au lieu de {move}, {best} gagnait gros.',
          'L\'erreur adverse reste impunie : {move} au lieu de {best}. Dommage pour {who} !',
          '{move} laisse {opp} respirer. {best} aurait exploité l\'erreur précédente.',
          'Cadeau refusé : {opp} offrait quelque chose, mais {who} joue {move} au lieu de {best}.',
          '{who} ne profite pas de la faute adverse. Avec {best}, la partie aurait pu être pliée.',
        ]), v);
        break;
      case 'missedMate': {
        const m = Math.abs(a.scoreBefore.mate || 0);
        title = pick(['Mat manqué !', 'Le mat était là', 'Si près du but']);
        text = fill(pick([
          'Il y avait un mat en {m} à partir de {best}, mais {who} joue {move}.',
          '{who} rate un mat en {m} ! {best} concluait immédiatement la partie.',
          'Le roi adverse était à portée : mat en {m} avec {best}. {who} a préféré {move}.',
        ]), { ...v, m });
        break;
      }
      case 'lead': {
        const lead = W[e.ply] >= 50 ? 'w' : 'b';
        title = pick(['Renversement', 'Changement de cap', 'Les rôles s\'inversent', 'Retournement']);
        text = fill(pick([
          'Après {move}, c\'est désormais {l} qui mène ({after}).',
          '{move} renverse la vapeur : {l} prend l\'avantage.',
          'Retournement de situation avec {move} — {l} passe devant ({before} → {after}).',
        ]), { ...v, l: N_(lead) });
        icon = a.cls;
        break;
      }
      case 'decisive':
        title = pick(['Point de non-retour', 'La partie bascule', 'Décisif', 'Tout est joué']);
        text = fill(pick([
          'À partir de {move}, {w} ne laissera plus échapper l\'avantage ({after}).',
          'Après {move}, la partie appartient à {w}. L\'adversaire ne reviendra plus.',
          '{move} marque le point de non-retour : {w} contrôle tout jusqu\'au bout.',
        ]), { ...v, w: N_(winner) });
        break;
      case 'queens':
        title = pick(['Échange des dames', 'Les dames quittent l\'échiquier']);
        text = fill(pick([
          'Les dames disparaissent avec {move}. Le jeu se simplifie ({after}).',
          '{move} : échange des dames. La partie change de visage.',
          'Plus de dames après {move} — place à un jeu plus technique.',
        ]), v);
        icon = 'forced';
        break;
      case 'endgame':
        title = pick(['Début de la finale', 'Place à la finale', 'Entrée en finale']);
        text = fill(pick([
          'Avec {move}, on entre en finale : {adv}.',
          'La finale commence au coup {n}. À ce moment, {adv}.',
          '{move} ouvre la phase finale, où {adv}.',
        ]), { ...v, adv: advantageText(e.ply), n: moveNum(e.ply) });
        icon = 'good';
        break;
      case 'mate':
        title = pick(['Échec et mat', 'Mat !', 'Le coup final']);
        text = fill(pick([
          '{who} conclut en beauté par {move}, échec et mat !',
          '{move} — mat. {who} termine le travail.',
          'Rideau : {move} met fin aux débats. Échec et mat !',
        ]), v);
        icon = 'best';
        break;
      case 'outOfBook':
        title = pick(['Fin de la théorie', 'Hors des sentiers battus', 'Sortie du livre']);
        text = fill(pick([
          '{move} : {who} quitte la théorie. {adv}.',
          'La théorie s\'arrête avec {move} de {who}.',
          '{who} sort du livre d\'ouvertures avec {move}.',
        ]), { ...v, adv: cap(advantageText(e.ply)) });
        icon = 'book';
        break;
    }
    return { ply: e.ply, type: e.type, icon, title, html: text, color: c };
  });

  /* ======================================================= RÉCIT */
  const sections = [];

  // ---------- 1. Ouverture
  {
    const parts = [];
    if (opening) {
      const [eco, name] = opening.split('|');
      parts.push(fill(pick([
        'La partie s\'ouvre sur {o} ({e}).',
        'Au programme : {o} ({e}).',
        'Les joueurs se lancent dans {o} ({e}).',
        'Le décor est planté avec {o} ({e}).',
        'On assiste à {o} ({e}).',
      ]), { o: `<b>${esc(name)}</b>`, e: esc(eco) }));
    } else {
      parts.push(pick(['La partie démarre hors des sentiers battus.', 'Pas d\'ouverture répertoriée ici : les joueurs improvisent dès le départ.', 'Les premiers coups sortent rapidement des chemins balisés.']));
    }
    if (bookEnd >= 16) parts.push(fill(pick(['Les deux joueurs connaissent leur théorie et enchaînent {n} coups de livre.', 'La théorie est respectée pendant {n} demi-coups : du solide.', 'Pendant {n} demi-coups, tout se joue « comme dans les livres ».']), { n: bookEnd }));
    else if (bookEnd >= 6) parts.push(fill(pick(['La théorie tient {n} demi-coups.', 'On reste dans le livre pendant {n} demi-coups.', 'Les {n} premiers demi-coups sont théoriques.']), { n: bookEnd }));
    if (bookEnd < N) {
      const a = ann[bookEnd + 1];
      if (bookEnd > 0) parts.push(fill(pick(['C\'est {who} qui sort le premier de la théorie avec {m}.', '{who} est le premier à improviser, avec {m}.', '{m} de {who} marque la fin de la théorie.']), { who: N_(a.color), m: ref(bookEnd + 1) }));
    }
    const openingErrors = ann.filter(a => a && a.phase === 'opening' && (a.cls === 'blunder' || a.cls === 'mistake' || a.cls === 'miss'));
    if (openingErrors.length) {
      const e = openingErrors.sort((x, y) => y.loss - x.loss)[0];
      parts.push(fill(pick([
        'Mais dès l\'ouverture, {who} trébuche avec {m} ({cls}).',
        'Hélas, {m} de {who} ({cls}) vient déjà perturber l\'ouverture.',
        'L\'ouverture n\'est pas sans accroc : {m} ({cls}) de {who}.',
      ]), { who: N_(e.color), m: ref(e.ply), cls: CLASSES[e.cls].label.toLowerCase() }));
    }
    const endOpening = Math.min(N, Math.max(bookEnd, (ann.findLast?.(a => a && a.phase === 'opening') || {}).ply || bookEnd, 1));
    parts.push(fill(pick(['À la sortie de l\'ouverture, {adv} {e}.', 'Bilan de l\'ouverture : {adv} {e}.', 'Une fois les pièces développées, {adv} {e}.']), { adv: advantageText(endOpening), e: ev(endOpening) }));
    sections.push({ title: 'L\'ouverture', icon: 'book', html: parts.join(' ') });
  }

  // ---------- 2. Déroulement / milieu de jeu
  {
    const parts = [];
    let leadChanges = 0, leader = null;
    for (let i = 1; i <= N; i++) {
      const l = W[i] > 65 ? 'w' : W[i] < 35 ? 'b' : null;
      if (l && leader && l !== leader) leadChanges++;
      if (l) leader = l;
    }
    const maxW = Math.max(...W), minW = Math.min(...W);
    const allEqual = maxW < 65 && minW > 35;
    let dominanceFrom = null;
    if (winner) for (let k = N; k >= 1; k--) { if (mw(k, winner) < 60) break; dominanceFrom = k; }
    const comeback = winner && Math.min(...W.map((_, i) => mw(i, winner))) <= 20;
    const lowPoint = winner ? W.map((_, i) => mw(i, winner)).indexOf(Math.min(...W.map((_, i) => mw(i, winner)))) : 0;
    const thrown = (() => { // un joueur était gagnant mais n'a pas gagné
      for (const c of ['w', 'b']) if (winner !== c && Math.max(...W.map((_, i) => mw(i, c))) >= 85) return c;
      return null;
    })();

    if (allEqual) {
      parts.push(pick([
        'Une partie d\'un grand équilibre : jamais un camp n\'a pris un avantage significatif.',
        'Le combat est resté serré du début à la fin, l\'évaluation ne s\'éloignant jamais de l\'égalité.',
        'Aucun des deux joueurs n\'a réussi à faire pencher la balance durablement.',
      ]));
    } else if (comeback && lowPoint > 0) {
      parts.push(fill(pick([
        'Quel retournement ! {w} était au bord du gouffre au coup {n} ({e}), mais a su renverser complètement la situation.',
        'Une remontée spectaculaire : {w} semblait perdu au coup {n} ({e}) et s\'en sort pourtant victorieux.',
        '{w} revient de très loin. Au coup {n}, l\'évaluation était de {e} contre lui… et pourtant !',
      ]), { w: N_(winner), n: moveNum(lowPoint), e: ev(lowPoint) }));
    } else if (leadChanges >= 2) {
      parts.push(fill(pick([
        'Une partie mouvementée : l\'avantage a changé de camp {k} fois.',
        'Les montagnes russes ! L\'avantage passe d\'un camp à l\'autre à {k} reprises.',
        'Personne ne contrôle vraiment la partie : {k} renversements d\'avantage au total.',
      ]), { k: leadChanges }));
    } else if (winner && dominanceFrom && dominanceFrom <= N * 0.45) {
      parts.push(fill(pick([
        '{w} prend le contrôle dès le coup {n} et ne le lâche plus.',
        'Démonstration de {w} : avantageux dès le coup {n}, il ne laisse aucune chance.',
        'À partir du coup {n}, {w} dicte le rythme et l\'adversaire subit.',
      ]), { w: N_(winner), n: moveNum(dominanceFrom) }));
    } else if (winner) {
      parts.push(fill(pick([
        'Le milieu de jeu reste disputé avant que {w} ne fasse la différence.',
        'Longtemps indécise, la partie finit par tourner en faveur de {w}.',
        'Il faut attendre la seconde moitié de la partie pour voir {w} se détacher.',
      ]), { w: N_(winner) }));
    } else {
      parts.push(pick([
        'Les deux camps ont eu leurs moments, sans que l\'un ne parvienne à conclure.',
        'Chaque joueur a eu sa période de domination, mais personne n\'a su l\'emporter.',
      ]));
    }
    if (thrown) {
      const peak = W.map((_, i) => mw(i, thrown)).indexOf(Math.max(...W.map((_, i) => mw(i, thrown))));
      parts.push(fill(pick([
        '{p} a pourtant eu la victoire entre les mains (au coup {n}, {e}).',
        'Rageant pour {p}, qui était gagnant au coup {n} ({e}).',
        'À noter : {p} a laissé passer une position gagnante au coup {n} ({e}).',
      ]), { p: N_(thrown), n: moveNum(peak), e: ev(peak) }));
    }
    for (const c of ['w', 'b']) {
      const arr = W.map((_, i) => mw(i, c));
      if (c === thrown) continue;
      const peak = Math.max(...arr), at = arr.indexOf(peak);
      if (peak >= 75 && !allEqual) parts.push(fill(pick([
        'Au plus fort, {p} a atteint {e} (coup {n}).',
        'Le meilleur moment {d} : {e} au coup {n}.',
        '{p} a culminé à {e} vers le coup {n}.',
      ]), { p: N_(c), d: de(c), e: ev(at), n: moveNum(at) }));
    }
    const errTotals = ['w', 'b'].map(c => ann.filter(a => a && a.color === c && (a.cls === 'blunder' || a.cls === 'mistake')).length);
    if (errTotals[0] + errTotals[1] >= 6) parts.push(pick(['Une partie riche en rebondissements, avec beaucoup d’erreurs de part et d’autre.', 'Les fautes se sont multipliées des deux côtés : une partie très humaine !']));
    else if (errTotals[0] + errTotals[1] === 0) parts.push(pick(['Aucune erreur sérieuse de part et d’autre : une partie de grande tenue.', 'Ni erreur ni gaffe : les deux joueurs ont livré une partie propre.']));
    const brill = ann.filter(a => a && a.cls === 'brilliant');
    if (brill.length) parts.push(fill(pick(['Mention spéciale pour {list}, coup{s} brillant{s} de la partie.', 'On retiendra {list} : du grand art.', 'La partie est illuminée par {list}.']), { list: brill.map(a => ref(a.ply)).join(', '), s: brill.length > 1 ? 's' : '' }));
    sections.push({ title: 'Le déroulement', icon: 'great', html: parts.join(' ') });
  }

  // ---------- 3. Le tournant
  {
    let tp = null, best = 0;
    for (let i = 1; i <= N; i++) {
      const a = ann[i];
      const swing = Math.abs(W[i] - W[i - 1]);
      const s = (ERR.has(a.cls) ? a.loss : 0) + (winner && a.color !== winner && ERR.has(a.cls) ? 5 : 0) + swing * 0.3;
      if (ERR.has(a.cls) && s > best) { best = s; tp = i; }
    }
    if (tp && ann[tp].loss >= 8) {
      const a = ann[tp];
      const parts = [];
      parts.push(fill(pick([
        'Le moment décisif survient au coup {n} avec {m} de {who}.',
        'Si l\'on devait retenir un seul coup, ce serait {m}, joué par {who}.',
        'Tout bascule au coup {n} : {who} joue {m}.',
        'Le tournant de la partie : {m} de {who}.',
      ]), { n: moveNum(tp), m: ref(tp), who: N_(a.color) }));
      parts.push(fill(pick([
        'Avant ce coup, {adv1} {e1} ; juste après, {adv2} {e2}.',
        'L\'évaluation passe de {e1} à {e2} : {adv2}.',
        'En un coup, on passe de « {adv1} » à « {adv2} » ({e1} → {e2}).',
      ]), { adv1: advantageText(tp - 1), adv2: advantageText(tp), e1: ev(tp - 1), e2: ev(tp) }));
      const cons = consequence(tp);
      if (cons) parts.push(cap(fill(pick(['ce coup {c}.', 'concrètement, {m} {c}.', 'le problème : ce coup {c}.']), { c: cons, m: ref(tp) })));
      parts.push(bestPhrase(a));
      if (clocks && clocks.spent[tp] != null) {
        const t = clocks.spent[tp];
        if (t < 3) parts.push(pick([`Joué en ${t.toFixed(1)} s seulement : un peu de réflexion aurait pu tout changer.`, `Un coup joué très vite (${t.toFixed(1)} s) — la précipitation ne pardonne pas.`]));
        else if (t > 60) parts.push(pick([`Pourtant, ${Math.round(t)} s de réflexion avaient été consacrées à ce coup.`, `Malgré une longue réflexion (${Math.round(t)} s), la mauvaise piste a été choisie.`]));
        if (clocks.left[tp] != null && clocks.base && clocks.left[tp] < Math.max(15, clocks.base * 0.1)) parts.push(pick(['Le manque de temps a sans doute pesé.', `Avec seulement ${fmtSec(clocks.left[tp])} à la pendule, difficile d'être précis.`]));
      }
      sections.push({ title: 'Le tournant', icon: a.cls, html: parts.join(' ') });
    }
  }

  // ---------- 4. La finale
  if (endgameStart && endgameStart < N) {
    const parts = [];
    parts.push(fill(pick([
      'La finale débute au coup {n} ({m}) : {adv} {e}.',
      'On entre en finale vers le coup {n}. À ce moment, {adv} {e}.',
      'Au coup {n}, les pièces lourdes ont quitté l\'échiquier et {adv} {e}.',
    ]), { n: moveNum(endgameStart), m: ref(endgameStart), adv: advantageText(endgameStart), e: ev(endgameStart) }));
    if (queensOff && queensOff <= endgameStart + 2) parts.push(pick(['L\'échange des dames a précipité cette transition.', 'Les dames étaient déjà parties, ce qui a simplifié le jeu.']));
    const egErr = ann.filter(a => a && a.phase === 'endgame' && (a.cls === 'blunder' || a.cls === 'mistake' || a.cls === 'miss'));
    const startLead = W[endgameStart] > 65 ? 'w' : W[endgameStart] < 35 ? 'b' : null;
    if (startLead && winner === startLead && !egErr.some(a => a.color === startLead)) {
      parts.push(fill(pick(['{p} convertit son avantage sans trembler.', 'La technique de {p} est impeccable : la conversion est propre.', '{p} déroule et transforme l\'avantage en victoire.']), { p: N_(startLead) }));
    } else if (startLead && winner !== startLead) {
      parts.push(fill(pick(['Mais {p} ne parvient pas à concrétiser son avantage en finale.', 'La finale échappe pourtant à {p}, qui ne trouve pas le chemin du gain.', 'Toute la difficulté des finales : {p} laisse filer le point.']), { p: N_(startLead) }));
    } else if (!startLead && winner) {
      parts.push(fill(pick(['Dans une finale équilibrée, c\'est {p} qui se montre le plus précis.', 'Finale serrée, remportée par le plus technique : {p}.']), { p: N_(winner) }));
    }
    if (egErr.length) {
      const counts = { w: egErr.filter(a => a.color === 'w').length, b: egErr.filter(a => a.color === 'b').length };
      if (counts.w && counts.b) parts.push(fill(pick(['La finale est loin d’être parfaite : {kw} pour {pw}, {kb} pour {pb}.', 'Des deux côtés, la technique vacille : {pw} commet {kw}, {pb} {kb}.']), { pw: N_('w'), pb: N_('b'), kw: plural(counts.w, 'erreur', 'erreurs'), kb: plural(counts.b, 'erreur', 'erreurs') }));
      else for (const c of ['w', 'b']) if (counts[c]) parts.push(fill(pick(['{p} commet {k} en finale.', 'En finale, {p} se trompe {x}.']), { p: N_(c), k: plural(counts[c], 'erreur', 'erreurs'), x: counts[c] > 1 ? `${counts[c]} fois` : 'une fois' }));
    }
    sections.push({ title: 'La finale', icon: 'good', html: parts.join(' ') });
  }

  // ---------- 5. Le dénouement
  {
    const parts = [];
    const loser = winner ? other(winner) : null;
    const lastPly = N;
    const finalW = winner ? mw(N, winner) : null;
    switch (term) {
      case 'checkmate':
        parts.push(fill(pick(['{w} conclut par un échec et mat au coup {n} ({m}).', 'La partie se termine sur un mat : {m} de {w}.', 'Rideau au coup {n} : {m}, échec et mat signé {w}.']), { w: N_(winner), n: moveNum(lastPly), m: ref(lastPly) }));
        break;
      case 'resign':
        parts.push(fill(pick(['{l} abandonne après {m}.', 'Après {m}, {l} jette l\'éponge.', '{l} préfère abandonner au coup {n}.']), { l: N_(loser), m: ref(lastPly), n: moveNum(lastPly) }));
        if (finalW != null && finalW < 70) parts.push(pick(['Un abandon un peu prématuré : la position offrait encore des ressources.', 'L\'évaluation finale montrait pourtant une position encore jouable — il ne faut jamais abandonner trop tôt !']));
        else if (finalW != null && finalW > 95) parts.push(pick(['Un abandon logique, la position était désespérée.', 'Rien à redire : il n\'y avait plus rien à espérer.']));
        break;
      case 'time':
        parts.push(fill(pick(['{l} perd au temps.', 'Le drapeau de {l} tombe : défaite au temps.', 'La pendule a tranché : {l} dépasse le temps imparti.']), { l: N_(loser) }));
        if (finalW != null && finalW < 40) parts.push(fill(pick(['Cruel : {l} était pourtant mieux sur l\'échiquier ({e}) !', 'Rageant, car sur l\'échiquier, c\'est {l} qui avait l\'avantage ({e}).']), { l: N_(loser), e: ev(N) }));
        else if (finalW != null && finalW < 65) parts.push(pick(['La position était encore indécise sur l\'échiquier.', `L'évaluation restait proche de l'équilibre (${ev(N)}) : c'est vraiment la pendule qui a décidé.`]));
        else parts.push(pick(['De toute façon, la position était déjà compromise.', 'La partie était déjà mal embarquée sur l\'échiquier.']));
        break;
      case 'abandon':
        parts.push(fill(pick(['{l} quitte la partie : victoire par abandon de la connexion.', 'La partie est abandonnée par {l}.']), { l: N_(loser) }));
        break;
      case 'stalemate':
        parts.push(pick(['Pat ! La partie se termine sur une nulle surprise.', 'Le roi n\'a plus de coup légal sans être en échec : c\'est pat, partie nulle.']));
        if (Math.abs(W[N - 1] - 50) > 30) parts.push(fill(pick(['Un vrai coup du sort pour {p}, qui était gagnant juste avant.', '{p} avait la victoire en poche… et a offert le pat.']), { p: N_(W[N - 1] > 50 ? 'w' : 'b') }));
        break;
      case 'repetition':
        parts.push(pick(['Nulle par répétition de la position.', 'Les joueurs répètent les coups : partie nulle.', 'La triple répétition met fin au combat.']));
        break;
      case 'agreement':
        parts.push(pick(['Les deux joueurs s\'accordent sur la nulle.', 'Nulle par accord mutuel.', 'Une poignée de main conclut la partie : nulle.']));
        break;
      case 'insufficient':
      case 'timeout-draw':
        parts.push(pick(['Nulle par matériel insuffisant.', 'Plus assez de matériel pour mater : partie nulle.']));
        break;
      case 'fifty':
        parts.push('Nulle par la règle des 50 coups.');
        break;
      default:
        if (winner) parts.push(fill(pick(['Victoire de {w}.', '{w} remporte la partie.', 'Le point revient à {w}.']), { w: N_(winner) }));
        else if (isDraw) parts.push('La partie se termine par une nulle.');
        else parts.push(fill('La partie s\'arrête au coup {n} : {adv}.', { n: moveNum(N), adv: advantageText(N) }));
    }
    if (isDraw && Math.abs(W[N] - 50) > 25) parts.push(fill(pick(['Pourtant, {p} avait de quoi jouer pour le gain ({e}).', 'Dommage pour {p}, qui disposait d\'un avantage sérieux ({e}).']), { p: N_(W[N] > 50 ? 'w' : 'b'), e: ev(N) }));
    parts.push(fill(pick(['La partie aura duré {k} coups.', 'Au total : {k} coups.', 'Durée de la bataille : {k} coups.']), { k: moveNum(N) }));
    sections.push({ title: 'Le dénouement', icon: winner ? 'best' : 'good', html: parts.join(' ') });
  }

  // ---------- 6. La gestion du temps
  if (clocks) {
    const parts = [];
    for (const c of ['w', 'b']) {
      const t = clocks.byColor[c];
      if (!t) continue;
      if (t.longest) parts.push(fill(pick([
        'La plus longue réflexion {d} : {s} sur {m}.',
        '{P} a pris {s} pour jouer {m}, sa plus longue réflexion.',
        'Gros temps de réflexion {d} sur {m} : {s}.',
      ]), { d: de(c), P: N_(c), s: fmtSec(t.longest.t), m: ref(t.longest.ply) }));
      if (t.troubleFrom) {
        parts.push(fill(pick([
          '{P} entre en zeitnot vers le coup {n} (moins de {lim} à la pendule).',
          'À partir du coup {n}, {P} joue avec moins de {lim}.',
          'La pendule devient un problème pour {P} dès le coup {n}.',
        ]), { P: N_(c), n: moveNum(t.troubleFrom), lim: fmtSec(clocks.troubleLimit) }));
        if (t.errorsInTrouble) parts.push(fill(pick(['Résultat : {k} sous pression.', 'Le stress se paie : {k} dans cette phase.']), { k: plural(t.errorsInTrouble, 'erreur', 'erreurs') }));
      }
      if (t.fastErrors.length) parts.push(fill(pick(['{P} a joué {m} en {s} : un peu de patience aurait évité l\'erreur.', 'Trop rapide : {m} de {P}, joué en {s}.']), { P: N_(c), m: ref(t.fastErrors[0].ply), s: t.fastErrors[0].t.toFixed(1) + ' s' }));
    }
    const ratio = clocks.byColor.w && clocks.byColor.b ? clocks.byColor.w.avg / Math.max(0.1, clocks.byColor.b.avg) : 1;
    if (ratio > 1.6 || ratio < 0.6) {
      const slow = ratio > 1 ? 'w' : 'b';
      parts.push(fill(pick(['{P} a réfléchi nettement plus longtemps en moyenne ({a} contre {b} par coup).', 'Écart de rythme marqué : {a} par coup pour {P}, contre {b} pour son adversaire.']), { P: N_(slow), a: fmtSec(clocks.byColor[slow].avg), b: fmtSec(clocks.byColor[other(slow)].avg) }));
    } else if (clocks.byColor.w && clocks.byColor.b) {
      parts.push(pick(['Les deux joueurs ont géré leur temps de façon assez similaire.', 'Rythme comparable des deux côtés de l\'échiquier.']));
    }
    if (parts.length) sections.push({ title: 'La gestion du temps', icon: 'forced', html: parts.join(' ') });
  }

  // ---------- 7. Les chiffres
  {
    const P = result.summary.players;
    const parts = [];
    const stat = c => {
      const mine = ann.filter(a => a && a.color === c);
      let run = 0, bestRun = 0, runEnd = 0;
      mine.forEach(a => { if (GOOD.has(a.cls)) { run++; if (run > bestRun) { bestRun = run; runEnd = a.ply; } } else run = 0; });
      const topMoves = mine.filter(a => ['best', 'great', 'brilliant'].includes(a.cls)).length;
      const nonBook = mine.filter(a => a.cls !== 'book').length;
      return { bestRun, runEnd, topPct: nonBook ? Math.round(topMoves / nonBook * 100) : 0, errors: mine.filter(a => ERR.has(a.cls)).length };
    };
    const S = { w: stat('w'), b: stat('b') };
    const aw = P.w.accuracy, ab = P.b.accuracy;
    if (aw != null && ab != null) {
      const diff = aw - ab, betterC = diff >= 0 ? 'w' : 'b';
      if (Math.abs(diff) < 3) parts.push(fill(pick(['Niveau de jeu très proche : {a} % contre {b} % de précision.', 'Précisions quasi identiques ({a} % / {b} %) : un vrai duel.']), { a: aw.toFixed(1), b: ab.toFixed(1) }));
      else if (Math.abs(diff) < 10) parts.push(fill(pick(['{P} a été un peu plus précis ({x} % contre {y} %).', 'Léger avantage de précision pour {P} : {x} % contre {y} %.']), { P: N_(betterC), x: Math.max(aw, ab).toFixed(1), y: Math.min(aw, ab).toFixed(1) }));
      else parts.push(fill(pick(['{P} a nettement mieux joué : {x} % de précision contre {y} %.', 'Écart de précision important en faveur de {P} ({x} % contre {y} %).']), { P: N_(betterC), x: Math.max(aw, ab).toFixed(1), y: Math.min(aw, ab).toFixed(1) }));
      if (winner && betterC !== winner && Math.abs(diff) >= 5) parts.push(pick(['Paradoxe : ce n\'est pas le joueur le plus précis qui l\'emporte. Aux échecs, une seule erreur peut suffire.', 'Preuve que la précision moyenne ne fait pas tout : c\'est le moment critique qui compte.']));
    }
    for (const c of ['w', 'b']) {
      const s = S[c];
      if (s.bestRun >= 6) parts.push(fill(pick(['{P} a enchaîné {k} bons coups d\'affilée (jusqu\'à {m}).', 'Belle série de {k} coups solides pour {P}, jusqu\'à {m}.']), { P: N_(c), k: s.bestRun, m: ref(s.runEnd) }));
      parts.push(fill(pick(['{P} a joué le coup du moteur dans {p} % des cas hors théorie.', '{p} % des coups {d} (hors théorie) correspondent au premier choix de Stockfish.']), { P: N_(c), d: de(c), p: s.topPct }));
    }
    for (const c of ['w', 'b']) {
      const p = P[c];
      if (p.elo && player(c).rating) {
        const delta = p.elo - player(c).rating;
        if (delta > 250) parts.push(fill(pick(['{P} a joué bien au-dessus de son classement (performance ≈ {e} pour {r} Elo).', 'Partie de haut vol pour {P} : niveau estimé ≈ {e}, pour un classement de {r}.']), { P: N_(c), e: p.elo, r: player(c).rating }));
        else if (delta < -350) parts.push(fill(pick(['{P} a joué en dessous de son niveau habituel (≈ {e} pour {r} Elo).', 'Jour sans pour {P} : performance ≈ {e}, loin de ses {r} Elo.']), { P: N_(c), e: p.elo, r: player(c).rating }));
      }
    }
    sections.push({ title: 'Les chiffres', icon: 'excellent', html: parts.join(' ') });
  }

  /* ======================================================= CONSEILS */
  const tips = [];
  const focus = myColor ? [myColor] : ['w', 'b'];
  for (const c of focus) {
    const p = result.summary.players[c];
    const who = myColor ? '' : `${N_(c)} : `;
    const mine = ann.filter(a => a && a.color === c);
    const cnt = k => mine.filter(a => a.cls === k).length;
    const add = (icon, arr) => tips.push({ icon, html: who + pick(arr) });
    if (cnt('brilliant')) add('brilliant', ['Bravo pour le coup brillant, c\'est rare !', 'Un coup brillant dans la partie : l\'intuition tactique est là.', 'Ce sacrifice montre un vrai sens de l\'attaque, continuez ainsi.']);
    if (cnt('miss')) add('miss', ['Après chaque coup adverse, demandez-vous : « qu\'est-ce que ce coup a laissé sans défense ? »', 'Des occasions manquées : travaillez les puzzles pour mieux repérer les tactiques.', 'Quand l\'adversaire se trompe, prenez le temps de chercher la punition : échecs, captures, menaces.']);
    if (cnt('blunder') >= 2) add('blunder', ['Plusieurs gaffes : avant de jouer, vérifiez toujours les échecs, captures et menaces de l\'adversaire.', 'Avant chaque coup, faites un « contrôle de sécurité » : ma pièce est-elle protégée ? Que menace-t-il ?', 'Ralentir sur les coups critiques éviterait la plupart de ces gaffes.']);
    else if (cnt('blunder') === 1) add('blunder', ['Une seule gaffe, mais coûteuse. Un dernier contrôle avant de lâcher la pièce aurait suffi.', 'Une gaffe isolée : prenez l\'habitude de regarder les réponses forcées adverses.']);
    if (p.phaseIcons?.opening && ['inaccuracy', 'mistake', 'blunder'].includes(p.phaseIcons.opening)) add('book', ['L\'ouverture mérite d\'être travaillée : apprenez les plans plutôt que les coups par cœur.', 'Principes d\'ouverture : développez vos pièces, contrôlez le centre, roquez tôt.', 'Revoir cette ouverture vous donnerait de meilleures positions dès le départ.']);
    if (p.phaseIcons?.endgame && ['inaccuracy', 'mistake', 'blunder'].includes(p.phaseIcons.endgame)) add('good', ['Les finales ont posé problème : l\'activité du roi et les pions passés sont la clé.', 'Travaillez les finales de base (tours, pions) : elles reviennent sans arrêt.', 'En finale, chaque tempo compte : centralisez le roi et créez des pions passés.']);
    if (clocks?.byColor[c]?.errorsInTrouble) add('forced', ['La gestion du temps a coûté des points : gardez une réserve pour la fin de partie.', 'Jouez plus vite les coups évidents pour garder du temps pour les moments critiques.', 'Le zeitnot a provoqué des erreurs : fixez-vous un budget de temps par phase.']);
    const peak = Math.max(...W.map((_, i) => mw(i, c)));
    if (winner !== c && peak >= 85) add('mistake', ['Vous étiez gagnant : en position dominante, simplifiez et éliminez le contre-jeu adverse.', 'Convertir un avantage est un art : échangez les pièces, pas les pions, quand vous êtes devant.', 'Quand on mène, la prudence prime : cherchez d\'abord les ressources adverses.']);
    if (p.accuracy != null && p.accuracy >= 90) add('best', ['Très belle précision dans cette partie, félicitations !', 'Plus de 90 % de précision : une partie très propre.', 'Partie de grande qualité, peu de choses à reprocher.']);
    if (cnt('inaccuracy') >= 4 && !cnt('blunder')) add('inaccuracy', ['Pas de grosse faute, mais beaucoup d\'imprécisions : cherchez le coup le plus actif.', 'Beaucoup de petites imprécisions : elles finissent par s\'additionner.']);
  }

  /* ======================================================= TITRE */
  let headline;
  if (term === 'checkmate') headline = pick(['Une partie conclue par un mat', 'Jusqu\'au mat !', 'Le mat comme point final']);
  else if (isDraw) headline = pick(['Une bataille sans vainqueur', 'Partage des points', 'Match nul']);
  else if (winner && Math.min(...W.map((_, i) => mw(i, winner))) <= 20) headline = pick(['Une remontée fantastique', 'Le retour du phénix', 'Jamais perdu tant que ce n\'est pas fini']);
  else if (ann.some(a => a && a.cls === 'brilliant')) headline = pick(['Une partie illuminée par un coup brillant', 'Du grand spectacle !', 'Brillant !']);
  else if (term === 'time') headline = pick(['La pendule a tranché', 'Course contre la montre', 'Le temps, juge de paix']);
  else headline = pick(['Le récit de la partie', 'Comment la partie s\'est jouée', 'La partie, coup par coup']);

  const fixCaps = h => h.replace(/de <b>le camp/g, 'du <b>camp').replace(/à <b>le camp/g, 'au <b>camp').replace(/(^|[.!?:—]\s+|^<b>|[.!?]\s+<b>)(le camp)/g, (m, p1, p2) => p1 + 'Le camp');
  moments.forEach(m => { m.html = fixCaps(m.html); });
  sections.forEach(x => { x.html = fixCaps(x.html); });
  tips.forEach(t => { t.html = fixCaps(t.html); });
  return { moments, sections, tips: tips.slice(0, 6), headline };
}

/* ---------------------------------------------------------------- fin de partie */

function detectTermination(game, positions) {
  const t = (game.termination || '').toLowerCase();
  const last = positions[positions.length - 1];
  if (last.terminal?.score?.mate === 0 || /checkmate|échec et mat|\bmat\b/.test(t)) return 'checkmate';
  if (/insufficient/.test(t) && /time|timeout/.test(t)) return 'timeout-draw';
  if (/stalemate|\bpat\b/.test(t)) return 'stalemate';
  if (/repetition|répétition/.test(t)) return 'repetition';
  if (/agreement|accord/.test(t)) return 'agreement';
  if (/insufficient|insuffisant/.test(t)) return 'insufficient';
  if (/50|fifty/.test(t)) return 'fifty';
  if (/abandoned|abandonment/.test(t)) return 'abandon';
  if (/resign|abandon/.test(t)) return 'resign';
  if (/time|temps/.test(t)) return 'time';
  if (last.terminal && last.terminal.score.cp === 0) {
    try { if (new Chess(last.fen).isStalemate()) return 'stalemate'; } catch {}
    return 'insufficient';
  }
  if (game.result === '1-0' || game.result === '0-1') return 'resign';
  return 'unknown';
}

/* ---------------------------------------------------------------- pendule */

function fmtSec(s) {
  if (s == null) return '';
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m} min${r ? ' ' + String(r).padStart(2, '0') : ''}`;
}

function analyseClocks(game, positions, ann) {
  const clocks = game.clocks;
  const N = positions.length - 1;
  if (!clocks || clocks.length < N - 1) return null;
  const m = /^(\d+)(?:\+(\d+(?:\.\d+)?))?$/.exec(game.timeControl || '');
  const base = m ? +m[1] : null, inc = m ? +(m[2] || 0) : 0;
  const troubleLimit = base ? Math.max(10, Math.min(60, base * 0.1)) : 30;
  const spent = [], left = [];
  for (let k = 1; k <= N; k++) {
    const c = positions[k].move.color;
    left[k] = clocks[k - 1];
    let prev = base;
    for (let j = k - 1; j >= 1; j--) if (positions[j].move.color === c) { prev = clocks[j - 1]; break; }
    spent[k] = prev != null && clocks[k - 1] != null ? Math.max(0, prev - clocks[k - 1] + (k > 2 ? inc : 0)) : null;
  }
  const byColor = {};
  for (const c of ['w', 'b']) {
    const plies = [];
    for (let k = 1; k <= N; k++) if (positions[k].move.color === c && spent[k] != null) plies.push(k);
    if (!plies.length) continue;
    let longest = null, sum = 0, troubleFrom = null, errorsInTrouble = 0;
    const fastErrors = [];
    for (const k of plies) {
      const t = spent[k];
      sum += t;
      if (!longest || t > longest.t) longest = { ply: k, t };
      if (troubleFrom == null && left[k] != null && left[k] < troubleLimit) troubleFrom = k;
      const a = ann[k];
      if (troubleFrom != null && a && ERR.has(a.cls) && a.cls !== 'inaccuracy') errorsInTrouble++;
      if (a && (a.cls === 'blunder' || a.cls === 'mistake') && t < 2) fastErrors.push({ ply: k, t });
    }
    byColor[c] = { longest: longest && longest.t >= 10 ? longest : null, avg: sum / plies.length, troubleFrom, errorsInTrouble, fastErrors };
  }
  return { base, inc, spent, left, troubleLimit, byColor };
}
