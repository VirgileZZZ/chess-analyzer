// Catégories de coups (libellés, couleurs et icônes façon chess.com).

export const CLASSES = {
  brilliant:  { label: 'Brillant',          short: '!!', color: '#26c2a3', text: 'est brillant' },
  great:      { label: 'Très bon coup',     short: '!',  color: '#749bbf', text: 'est un très bon coup' },
  best:       { label: 'Meilleur',          short: '★',  color: '#81b64c', text: 'est le meilleur coup' },
  excellent:  { label: 'Excellent',         short: '👍', color: '#96bc4b', text: 'est excellent' },
  good:       { label: 'Bon',               short: '✓',  color: '#96af8b', text: 'est bon' },
  book:       { label: 'Théorique',         short: '📖', color: '#a88865', text: 'est un coup théorique' },
  forced:     { label: 'Forcé',             short: '→',  color: '#96af8b', text: 'est forcé' },
  inaccuracy: { label: 'Imprécision',       short: '?!', color: '#f7c631', text: 'est une imprécision' },
  mistake:    { label: 'Erreur',            short: '?',  color: '#ffa459', text: 'est une erreur' },
  miss:       { label: 'Occasion manquée',  short: '✕',  color: '#ff7769', text: 'est une occasion manquée' },
  blunder:    { label: 'Gaffe',             short: '??', color: '#fa412d', text: 'est une gaffe' },
};

export const SUMMARY_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

const GLYPH = {
  brilliant: '<text x="12" y="16.6" font-size="11.5" font-weight="900" letter-spacing="-1.4" text-anchor="middle">!!</text>',
  great: '<text x="12" y="17" font-size="14" font-weight="900" text-anchor="middle">!</text>',
  best: '<path d="M12 5.2l2.05 4.3 4.7.6-3.45 3.25.88 4.67L12 15.75 7.82 18.02l.88-4.67L5.25 10.1l4.7-.6z"/>',
  excellent: '<path d="M7 11h2.6v7H7zM10.6 18v-7.3l2.6-4.6c.3-.5 1-.6 1.4-.2.4.3.5.8.4 1.2L14.3 10H18c.8 0 1.4.8 1.2 1.6l-1.3 5.2c-.2.7-.8 1.2-1.5 1.2z"/>',
  good: '<path d="M6.5 12.4l1.7-1.7 2.4 2.4 5.2-5.3 1.7 1.7-6.9 7z"/>',
  book: '<path d="M6 7.2c2-.6 4-.4 5.4.8v10c-1.4-1-3.4-1.2-5.4-.6zM18 7.2c-2-.6-4-.4-5.4.8v10c1.4-1 3.4-1.2 5.4-.6z"/>',
  forced: '<path d="M6 10.8h7.5V7.5L19 12l-5.5 4.5v-3.3H6z"/>',
  inaccuracy: '<text x="12" y="16.6" font-size="11" font-weight="900" letter-spacing="-.6" text-anchor="middle">?!</text>',
  mistake: '<text x="12" y="17" font-size="14" font-weight="900" text-anchor="middle">?</text>',
  miss: '<path d="M8.2 6.6L12 10.4l3.8-3.8 1.6 1.6-3.8 3.8 3.8 3.8-1.6 1.6-3.8-3.8-3.8 3.8-1.6-1.6 3.8-3.8-3.8-3.8z"/>',
  blunder: '<text x="12" y="16.6" font-size="11" font-weight="900" letter-spacing="-1" text-anchor="middle">??</text>',
};

/** Retourne le SVG (string) du badge d'une catégorie. */
export function classIcon(key, size = 20) {
  const c = CLASSES[key];
  if (!c) return '';
  return `<svg class="cls-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-label="${c.label}">` +
    `<circle cx="12" cy="12.8" r="11" fill="rgba(0,0,0,.25)"/>` +
    `<circle cx="12" cy="12" r="11" fill="${c.color}"/>` +
    `<g fill="#fff" font-family="Segoe UI, Arial, sans-serif">${GLYPH[key]}</g></svg>`;
}
