// Graphique d'évaluation façon chess.com (zone blanche = avantage Blancs).
import { CLASSES } from './classes.js';

const NS = 'http://www.w3.org/2000/svg';
const MARKED = new Set(['brilliant', 'great', 'miss', 'mistake', 'blunder', 'inaccuracy']);

export class EvalGraph {
  constructor(el, { onSelect, tooltip } = {}) {
    this.el = el;
    this.onSelect = onSelect;
    this.tooltip = tooltip;
    this.data = { wins: [], classes: [], cur: 0, flipped: false };
    this.svg = document.createElementNS(NS, 'svg');
    el.innerHTML = '';
    el.appendChild(this.svg);
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    this.tip.hidden = true;
    el.appendChild(this.tip);
    new ResizeObserver(() => this.render()).observe(el);
    el.addEventListener('mousemove', e => this.hover(e));
    el.addEventListener('mouseleave', () => { this.tip.hidden = true; this.hoverPly = null; this.render(); });
    el.addEventListener('click', e => {
      const ply = this.plyAt(e);
      if (ply != null && this.onSelect) this.onSelect(ply);
    });
  }

  set(data) { Object.assign(this.data, data); this.render(); }

  plyAt(e) {
    const n = this.data.wins.length - 1;
    if (n < 1) return null;
    const b = this.el.getBoundingClientRect();
    return Math.max(0, Math.min(n, Math.round((e.clientX - b.left) / b.width * n)));
  }

  hover(e) {
    const ply = this.plyAt(e);
    if (ply == null) return;
    this.hoverPly = ply;
    if (this.tooltip) {
      this.tip.textContent = this.tooltip(ply);
      this.tip.hidden = !this.tip.textContent;
      const b = this.el.getBoundingClientRect();
      const x = (e.clientX - b.left);
      this.tip.style.left = Math.min(b.width - this.tip.offsetWidth - 4, Math.max(4, x + 8)) + 'px';
    }
    this.render();
  }

  render() {
    const { wins, classes, cur, flipped } = this.data;
    const W = this.el.clientWidth, H = this.el.clientHeight;
    const svg = this.svg;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    if (!W || !H) return;
    const n = Math.max(1, wins.length - 1);
    const X = i => i / n * W;
    const Y = w => {
      const v = flipped ? w : 100 - w;
      return 2 + v / 100 * (H - 4);
    };
    // zone
    let d = `M0,${flipped ? 0 : H}`;
    let last = 50;
    wins.forEach((w, i) => { if (w != null) last = w; d += ` L${X(i)},${Y(last)}`; });
    d += ` L${X(wins.length - 1 || 0)},${flipped ? 0 : H} Z`;
    const area = el('path', { d, fill: '#fff' });
    svg.appendChild(el('line', { x1: 0, x2: W, y1: H / 2, y2: H / 2, stroke: '#8b8987', 'stroke-width': 1, opacity: .5 }));
    svg.appendChild(area);
    svg.appendChild(el('line', { x1: 0, x2: W, y1: H / 2, y2: H / 2, stroke: '#8b8987', 'stroke-width': 1, opacity: .35 }));
    // ligne courante / survol
    if (this.hoverPly != null) svg.appendChild(el('line', { x1: X(this.hoverPly), x2: X(this.hoverPly), y1: 0, y2: H, stroke: '#ffffff', 'stroke-opacity': .35, 'stroke-width': 1 }));
    if (cur != null && wins.length > 1) svg.appendChild(el('line', { x1: X(cur), x2: X(cur), y1: 0, y2: H, stroke: '#81b64c', 'stroke-width': 2 }));
    // points
    classes.forEach((c, i) => {
      if (!c || !MARKED.has(c) || wins[i] == null) return;
      svg.appendChild(el('circle', { cx: X(i), cy: Y(wins[i]), r: i === cur ? 5 : 3.6, fill: CLASSES[c].color, stroke: '#00000055', 'stroke-width': 1 }));
    });
  }
}

function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
