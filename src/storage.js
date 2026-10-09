// Cache des analyses et banque de puzzles (chrome.storage.local).

const MAX_CACHED = 60;
const store = chrome.storage.local;

export function cacheKey(game, s) {
  const base = game.id ? `cc-${game.id}` : 'pgn-' + hash(JSON.stringify([game.startFen || '', game.moves.map(m => m.from + m.to + (m.promotion || ''))]));
  const search = s.searchMode === 'time' ? `t${s.movetime}` : `d${s.depth}`;
  const eng = s.engine === 'full-single' ? 'full' : 'lite';
  return `${base}:${eng}:${search}`;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export async function getCachedAnalysis(key) {
  const r = await store.get('an:' + key);
  return r['an:' + key] || null;
}

export async function saveAnalysis(key, game, evals, meta) {
  const slim = evals.map(e => ({ d: e.depth, l: e.lines.map(l => ({ s: l.score, p: l.pv.slice(0, 12), d: l.depth })) }));
  await store.set({ ['an:' + key]: { game, evals: slim, savedAt: Date.now() } });
  const { anIndex = [] } = await store.get('anIndex');
  const idx = anIndex.filter(x => x.key !== key);
  idx.unshift({ key, white: game.white, black: game.black, result: game.result, date: game.date, savedAt: Date.now(), ...meta });
  const removed = idx.splice(MAX_CACHED);
  await store.set({ anIndex: idx });
  if (removed.length) await store.remove(removed.map(x => 'an:' + x.key));
}

export function expandEvals(slim) {
  return slim.map(e => ({ depth: e.d, lines: e.l.map((l, i) => ({ multipv: i + 1, score: l.s, pv: l.p, depth: l.d })) }));
}

export async function listAnalyses() {
  const { anIndex = [] } = await store.get('anIndex');
  return anIndex;
}

export async function deleteAnalysis(key) {
  const { anIndex = [] } = await store.get('anIndex');
  await store.set({ anIndex: anIndex.filter(x => x.key !== key) });
  await store.remove('an:' + key);
}

/* ---------- Puzzles ---------- */

export async function getPuzzles() {
  const { puzzles = [] } = await store.get('puzzles');
  return puzzles;
}

export async function addPuzzles(list) {
  if (!list.length) return 0;
  const cur = await getPuzzles();
  const ids = new Set(cur.map(p => p.id));
  const fresh = list.filter(p => !ids.has(p.id));
  if (fresh.length) await store.set({ puzzles: [...cur, ...fresh] });
  return fresh.length;
}

export async function updatePuzzle(id, patch) {
  const cur = await getPuzzles();
  const p = cur.find(x => x.id === id);
  if (p) Object.assign(p, patch);
  await store.set({ puzzles: cur });
}

export async function deletePuzzles(ids) {
  const set = new Set(ids);
  const cur = await getPuzzles();
  await store.set({ puzzles: cur.filter(p => !set.has(p.id)) });
}

export async function getPuzzleStats() {
  const { puzzleStats } = await store.get('puzzleStats');
  return { rating: 1200, streak: 0, bestStreak: 0, solved: 0, failed: 0, history: [], ...(puzzleStats || {}) };
}

export async function savePuzzleStats(s) {
  s.history = (s.history || []).slice(-200);
  await store.set({ puzzleStats: s });
}

/* ---------- Répertoires d'ouvertures ---------- */

export async function getRepertoires() {
  const { repertoires = [] } = await store.get('repertoires');
  return repertoires;
}

export async function saveRepertoires(list) {
  await store.set({ repertoires: list });
}

export async function getRepStats(id) {
  const k = 'repStats:' + id;
  const r = await store.get(k);
  return r[k] || {};
}

export async function saveRepStats(id, stats) {
  await store.set({ ['repStats:' + id]: stats });
}

export async function deleteRepertoire(id) {
  const list = (await getRepertoires()).filter(r => r.id !== id);
  await store.set({ repertoires: list });
  await store.remove('repStats:' + id);
}
