// Paramètres persistants (chrome.storage.local, clé "settings").

const cores = Math.max(1, (navigator.hardwareConcurrency || 4));

export const DEFAULTS = {
  // Moteur
  engine: 'lite-single',          // lite-single | lite-mt | full-single
  searchMode: 'depth',            // depth | time
  depth: 18,
  movetime: 1000,                 // ms par position
  workers: Math.min(4, Math.max(1, cores - 1)), // moteurs en parallèle pour le bilan
  hash: 32,                       // Mo par moteur
  threads: Math.min(4, cores),    // pour l'analyse en direct (lite-mt seulement)
  liveEngine: true,
  liveDepth: 22,
  multipv: 3,

  // Classification
  strictness: 'normal',           // lenient | normal | strict
  enableBrilliant: true,
  enableGreat: true,
  enableMiss: true,
  enableBook: true,
  brilliantPawnSacs: false,
  blunderNeedsMaterial: true,

  // Plateau
  boardTheme: 'green',
  pieceSet: 'cburnett',
  showCoords: true,
  animationMs: 160,
  showArrows: true,
  showClassIcons: true,
  showEvalBar: true,
  showGraph: true,
  showClocks: true,
  autoQueen: false,
  sound: true,
  volume: 0.6,

  // Chess.com
  intercept: 'all',               // all | button | off
  openIn: 'newtab',               // newtab | sametab
  floatingButton: true,
  username: '',
  autoFlip: true,
  cacheAnalyses: true,

};

export async function loadSettings() {
  try {
    const r = await chrome.storage.local.get('settings');
    return { ...DEFAULTS, ...(r.settings || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(patch) {
  const cur = await loadSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function resetSettings() {
  await chrome.storage.local.set({ settings: { ...DEFAULTS } });
  return { ...DEFAULTS };
}

export function onSettingsChanged(cb) {
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.settings) cb({ ...DEFAULTS, ...(ch.settings.newValue || {}) });
  });
}

export const BOARD_THEMES = {
  green:  { name: 'Vert (chess.com)', light: '#ebecd0', dark: '#739552', hlLight: '#f5f682', hlDark: '#b9ca43' },
  brown:  { name: 'Bois',             light: '#f0d9b5', dark: '#b58863', hlLight: '#f7ec74', hlDark: '#dac34b' },
  blue:   { name: 'Bleu',             light: '#dee3e6', dark: '#8ca2ad', hlLight: '#c3d888', hlDark: '#92b166' },
  ice:    { name: 'Glace',            light: '#d9e4e8', dark: '#7a9db2', hlLight: '#a9d3e8', hlDark: '#6aa3c4' },
  purple: { name: 'Violet',           light: '#efefef', dark: '#8877b7', hlLight: '#e9e17a', hlDark: '#b6a64f' },
  dark:   { name: 'Nuit',             light: '#9e9e9e', dark: '#4f4f4f', hlLight: '#c8c86e', hlDark: '#8f8f3c' },
  coral:  { name: 'Corail',           light: '#b1e4b9', dark: '#70a2a3', hlLight: '#e3f48a', hlDark: '#a8cc63' },
};

export const PIECE_SETS = { cburnett: 'Cburnett', merida: 'Merida', maestro: 'Maestro', alpha: 'Alpha' };

export const ENGINES = {
  'lite-single': { name: 'Stockfish 19 Lite (1 thread, 1,7 Mo) — rapide', file: 'stockfish-19-lite-single.js', mt: false },
  'lite-mt':     { name: 'Stockfish 19 Lite multi-thread', file: 'stockfish-19-lite.js', mt: true },
  'full-single': { name: 'Stockfish 19 complet (NNUE 99 Mo) — plus fort, plus lent', file: 'stockfish-19-single.js', mt: false },
};

/** Vérifie que les fichiers d'un moteur sont présents (le moteur complet de 99 Mo est optionnel). */
const availCache = {};
export async function engineAvailable(flavor) {
  const def = ENGINES[flavor];
  if (!def) return false;
  if (flavor in availCache) return availCache[flavor];
  try {
    const r = await fetch(chrome.runtime.getURL('engine/' + def.file.replace(/\.js$/, '.wasm')), { method: 'HEAD' });
    availCache[flavor] = r.ok;
  } catch { availCache[flavor] = false; }
  return availCache[flavor];
}

/** Moteur réellement utilisable (repli sur la version Lite si le moteur choisi est absent). */
export async function usableEngine(flavor) {
  return (await engineAvailable(flavor)) ? flavor : 'lite-single';
}
