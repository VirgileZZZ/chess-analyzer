// Échiquier interactif (DOM + SVG), sans dépendance.
import { BOARD_THEMES } from './settings.js';
import { classIcon } from './classes.js';

const FILES = 'abcdefgh';
const SVGNS = 'http://www.w3.org/2000/svg';

function parseBoard(fen) {
  const map = new Map();
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      map.set(FILES[f] + (8 - r), color + ch.toUpperCase());
      f++;
    }
  });
  return map;
}

export class Board {
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = {
      orientation: 'w', theme: 'green', pieceSet: 'cburnett', coords: true, animMs: 160,
      interactive: true, autoQueen: false, getDests: null, onMove: null, ...opts,
    };
    this.pieces = new Map();
    this.fen = null;
    this.selected = null;
    this.lastMove = null;
    this.arrows = [];
    this.userArrows = [];
    this.userMarks = new Set();
    this.badge = null;
    this.build();
  }

  build() {
    const el = this.el;
    el.classList.add('cb');
    el.innerHTML = '';
    this.sqLayer = div('cb-squares');
    this.pieceLayer = div('cb-pieces');
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'cb-arrows');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.badgeLayer = div('cb-badges');
    el.append(this.sqLayer, this.pieceLayer, this.svg, this.badgeLayer);
    this.squares = {};
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const sq = FILES[f] + (r + 1);
      const s = div('cb-sq ' + ((r + f) % 2 ? 'light' : 'dark'));
      s.dataset.sq = sq;
      this.squares[sq] = s;
      this.sqLayer.appendChild(s);
    }
    this.applyTheme();
    this.layoutSquares();
    this.bindEvents();
  }

  applyTheme() {
    const t = BOARD_THEMES[this.opts.theme] || BOARD_THEMES.green;
    const s = this.el.style;
    s.setProperty('--sq-light', t.light);
    s.setProperty('--sq-dark', t.dark);
    s.setProperty('--hl-light', t.hlLight);
    s.setProperty('--hl-dark', t.hlDark);
  }

  setOptions(o) {
    const needPieces = o.pieceSet && o.pieceSet !== this.opts.pieceSet;
    Object.assign(this.opts, o);
    this.applyTheme();
    this.layoutSquares();
    if (needPieces) for (const p of this.pieces.values()) p.el.style.backgroundImage = this.pieceUrl(p.code);
  }

  pieceUrl(code) {
    return `url(${chrome.runtime.getURL(`img/pieces/${this.opts.pieceSet}/${code}.svg`)})`;
  }

  xy(sq) {
    const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
    return this.opts.orientation === 'w' ? [f, 7 - r] : [7 - f, r];
  }

  sqAt(clientX, clientY) {
    const b = this.el.getBoundingClientRect();
    const x = Math.floor((clientX - b.left) / b.width * 8), y = Math.floor((clientY - b.top) / b.height * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return this.opts.orientation === 'w' ? FILES[x] + (8 - y) : FILES[7 - x] + (y + 1);
  }

  layoutSquares() {
    for (const [sq, s] of Object.entries(this.squares)) {
      const [x, y] = this.xy(sq);
      s.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
      s.innerHTML = '';
      if (this.opts.coords) {
        if (x === 0) s.insertAdjacentHTML('beforeend', `<span class="cb-rank">${sq[1]}</span>`);
        if (y === 7) s.insertAdjacentHTML('beforeend', `<span class="cb-file">${sq[0]}</span>`);
      }
    }
    for (const [sq, p] of this.pieces) this.placePiece(p.el, sq);
    this.drawArrows();
    this.drawBadge();
  }

  placePiece(el, sq) {
    const [x, y] = this.xy(sq);
    el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
  }

  flip() { this.setOrientation(this.opts.orientation === 'w' ? 'b' : 'w'); }
  setOrientation(o) {
    if (o === this.opts.orientation) return;
    this.opts.orientation = o;
    this.layoutSquares();
  }

  /** Affiche une position ; anime les pièces déplacées. */
  setPosition(fen, { lastMove = null, animate = true, check = null, lastMoveColor = null } = {}) {
    const target = parseBoard(fen);
    const old = new Map(this.pieces);
    const next = new Map();
    const anim = animate && this.opts.animMs > 0 && this.fen != null;
    // 1. pièces inchangées
    for (const [sq, code] of target) {
      const o = old.get(sq);
      if (o && o.code === code) { next.set(sq, o); old.delete(sq); }
    }
    // 2. pièces déplacées / nouvelles
    for (const [sq, code] of target) {
      if (next.has(sq)) continue;
      let bestK = null, bestD = 99;
      for (const [k, o] of old) {
        if (o.code !== code || target.get(k) === o.code) continue;
        const [x1, y1] = this.xy(k), [x2, y2] = this.xy(sq);
        const d = Math.abs(x1 - x2) + Math.abs(y1 - y2);
        if (d < bestD) { bestD = d; bestK = k; }
      }
      let p;
      if (bestK) {
        p = old.get(bestK);
        old.delete(bestK);
        p.el.style.transition = anim ? `transform ${this.opts.animMs}ms ease` : 'none';
        p.el.style.zIndex = 3;
        this.placePiece(p.el, sq);
        setTimeout(() => { p.el.style.zIndex = ''; }, this.opts.animMs);
      } else {
        const e = div('cb-piece');
        e.style.backgroundImage = this.pieceUrl(code);
        e.style.transition = 'none';
        this.placePiece(e, sq);
        if (anim) { e.style.opacity = 0; requestAnimationFrame(() => { e.style.transition = `opacity ${this.opts.animMs}ms`; e.style.opacity = 1; }); }
        this.pieceLayer.appendChild(e);
        p = { el: e, code };
      }
      next.set(sq, p);
    }
    // 3. pièces capturées
    for (const o of old.values()) {
      if (anim) {
        o.el.style.transition = `opacity ${this.opts.animMs}ms`;
        o.el.style.opacity = 0;
        setTimeout(() => o.el.remove(), this.opts.animMs);
      } else o.el.remove();
    }
    this.pieces = next;
    this.fen = fen;
    this.turn = fen.split(' ')[1];
    this.setSelected(null);
    this.userArrows = [];
    this.userMarks.clear();
    this.setLastMove(lastMove, lastMoveColor);
    this.setCheck(check);
    this.drawArrows();
  }

  setLastMove(lm, color = null) {
    for (const s of Object.values(this.squares)) { s.classList.remove('last'); s.style.removeProperty('--cls-color'); s.classList.remove('cls-tint'); }
    this.lastMove = lm;
    if (!lm) return;
    for (const sq of lm) {
      const s = this.squares[sq];
      if (!s) continue;
      s.classList.add('last');
      if (color) { s.classList.add('cls-tint'); s.style.setProperty('--cls-color', color); }
    }
  }

  setCheck(sq) {
    for (const s of Object.values(this.squares)) s.classList.remove('check');
    if (sq) this.squares[sq]?.classList.add('check');
  }

  setArrows(arrows) { this.arrows = arrows || []; this.drawArrows(); }

  setBadge(sq, cls) { this.badge = sq && cls ? { sq, cls } : null; this.drawBadge(); }

  drawBadge() {
    this.badgeLayer.innerHTML = '';
    if (!this.badge) return;
    const [x, y] = this.xy(this.badge.sq);
    const b = div('cb-badge');
    b.innerHTML = classIcon(this.badge.cls, 64);
    b.style.left = `${(x + 1) * 12.5}%`;
    b.style.top = `${y * 12.5}%`;
    this.badgeLayer.appendChild(b);
  }

  drawArrows() {
    const svg = this.svg;
    svg.innerHTML = '';
    const defs = document.createElementNS(SVGNS, 'defs');
    svg.appendChild(defs);
    const all = [...this.arrows, ...this.userArrows.map(a => ({ ...a, color: a.color || 'rgba(255,170,0,.8)' }))];
    for (const sq of this.userMarks) {
      const [x, y] = this.xy(sq);
      const r = document.createElementNS(SVGNS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1); r.setAttribute('height', 1);
      r.setAttribute('fill', 'rgba(235,97,80,.8)');
      svg.appendChild(r);
    }
    all.forEach((a, i) => {
      const color = a.color || 'rgba(255,170,0,.8)';
      const id = 'ah' + i;
      const m = document.createElementNS(SVGNS, 'marker');
      m.setAttribute('id', id);
      m.setAttribute('markerWidth', '4'); m.setAttribute('markerHeight', '4');
      m.setAttribute('refX', '0.1'); m.setAttribute('refY', '2');
      m.setAttribute('orient', 'auto'); m.setAttribute('markerUnits', 'strokeWidth');
      const mp = document.createElementNS(SVGNS, 'path');
      mp.setAttribute('d', 'M0,0 L2.05,2 L0,4 z');
      mp.setAttribute('fill', color);
      m.appendChild(mp);
      defs.appendChild(m);
      const [x1, y1] = this.xy(a.from).map(v => v + 0.5), [x2, y2] = this.xy(a.to).map(v => v + 0.5);
      const w = a.width || 0.2;
      const dx = x2 - x1, dy = y2 - y1;
      const knight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
      const head = 2.05 * w; // longueur de la pointe
      const p = document.createElementNS(SVGNS, 'path');
      let d;
      const sx = x1, sy = y1;
      if (knight) {
        const [cx, cy] = Math.abs(dx) > Math.abs(dy) ? [x2, y1] : [x1, y2];
        const ex = x2 - Math.sign(x2 - cx) * head, ey = y2 - Math.sign(y2 - cy) * head;
        const ox = Math.sign(cx - x1) * 0.3, oy = Math.sign(cy - y1) * 0.3;
        d = `M${sx + ox},${sy + oy} L${cx},${cy} L${ex},${ey}`;
      } else {
        const len = Math.hypot(dx, dy);
        const ux = dx / len, uy = dy / len;
        d = `M${x1 + ux * 0.3},${y1 + uy * 0.3} L${x2 - ux * head},${y2 - uy * head}`;
      }
      p.setAttribute('d', d);
      p.setAttribute('stroke', color);
      p.setAttribute('stroke-width', w);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-linejoin', 'miter');
      p.setAttribute('marker-end', `url(#${id})`);
      if (a.opacity) p.setAttribute('opacity', a.opacity);
      svg.appendChild(p);
    });
  }

  /* ---------- Interaction ---------- */

  setSelected(sq) {
    for (const s of Object.values(this.squares)) s.classList.remove('sel', 'dest', 'dest-cap');
    this.selected = sq;
    this.dests = [];
    if (!sq) return;
    this.squares[sq].classList.add('sel');
    this.dests = this.opts.getDests ? this.opts.getDests(sq) : [];
    for (const d of this.dests) this.squares[d.to].classList.add(this.pieces.has(d.to) ? 'dest-cap' : 'dest');
  }

  bindEvents() {
    const el = this.el;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointermove', e => this.onMoveP(e));
    window.addEventListener('pointerup', e => this.onUp(e));
  }

  canMoveFrom(sq) {
    if (!this.opts.interactive) return false;
    const p = this.pieces.get(sq);
    return p && p.code[0] === this.turn && this.opts.getDests && this.opts.getDests(sq).length > 0;
  }

  onDown(e) {
    const sq = this.sqAt(e.clientX, e.clientY);
    if (!sq) return;
    if (e.button === 2) { this.rightStart = sq; return; }
    if (e.button !== 0) return;
    if (this.userArrows.length || this.userMarks.size) { this.userArrows = []; this.userMarks.clear(); this.drawArrows(); }
    this.promoEl?.remove();
    if (this.selected && this.dests.some(d => d.to === sq)) {
      this.tryMove(this.selected, sq);
      return;
    }
    if (this.canMoveFrom(sq)) {
      const wasSelected = this.selected === sq;
      this.setSelected(sq);
      const p = this.pieces.get(sq);
      const b = this.el.getBoundingClientRect();
      this.drag = { from: sq, el: p.el, size: b.width / 8, wasSelected, moved: false, startX: e.clientX, startY: e.clientY };
      e.preventDefault();
    } else {
      this.setSelected(null);
    }
  }

  onMoveP(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
    d.moved = true;
    const b = this.el.getBoundingClientRect();
    d.el.style.transition = 'none';
    d.el.style.zIndex = 10;
    d.el.classList.add('dragging');
    d.el.style.transform = `translate(${e.clientX - b.left - d.size / 2}px, ${e.clientY - b.top - d.size / 2}px)`;
    const sq = this.sqAt(e.clientX, e.clientY);
    for (const s of Object.values(this.squares)) s.classList.remove('hover');
    if (sq) this.squares[sq].classList.add('hover');
  }

  onUp(e) {
    if (e.button === 2 && this.rightStart) {
      const sq = this.sqAt(e.clientX, e.clientY);
      const from = this.rightStart;
      this.rightStart = null;
      if (!sq) return;
      if (sq === from) {
        this.userMarks.has(sq) ? this.userMarks.delete(sq) : this.userMarks.add(sq);
      } else {
        const color = e.shiftKey ? 'rgba(235,97,80,.85)' : e.ctrlKey ? 'rgba(82,176,220,.85)' : e.altKey ? 'rgba(129,182,76,.9)' : 'rgba(255,170,0,.8)';
        const i = this.userArrows.findIndex(a => a.from === from && a.to === sq);
        if (i >= 0) this.userArrows.splice(i, 1); else this.userArrows.push({ from, to: sq, color });
      }
      this.drawArrows();
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    for (const s of Object.values(this.squares)) s.classList.remove('hover');
    d.el.classList.remove('dragging');
    d.el.style.zIndex = '';
    const sq = this.sqAt(e.clientX, e.clientY);
    if (d.moved && sq && sq !== d.from && this.dests.some(x => x.to === sq)) {
      d.el.style.transition = 'none';
      this.placePiece(d.el, sq);
      this.tryMove(d.from, sq, true);
      return;
    }
    this.placePiece(d.el, d.from);
    if (!d.moved && d.wasSelected) this.setSelected(null);
    else if (d.moved) this.setSelected(d.from);
  }

  tryMove(from, to, dropped = false) {
    const options = this.dests.filter(d => d.to === to);
    this.setSelected(null);
    if (!options.length) return;
    const promos = options.filter(o => o.promotion);
    if (promos.length && !this.opts.autoQueen) {
      this.showPromotion(from, to, dropped);
      return;
    }
    this.opts.onMove && this.opts.onMove({ from, to, promotion: promos.length ? 'q' : undefined });
  }

  showPromotion(from, to, dropped) {
    const color = this.pieces.get(from)?.code[0] || this.turn;
    const [x, y] = this.xy(to);
    const box = div('cb-promo');
    const down = y === 0;
    box.style.left = `${x * 12.5}%`;
    box.style.top = down ? '0' : 'auto';
    box.style.bottom = down ? 'auto' : '0';
    for (const p of ['q', 'n', 'r', 'b']) {
      const b = div('cb-promo-piece');
      b.style.backgroundImage = this.pieceUrl(color + p.toUpperCase());
      b.addEventListener('pointerdown', ev => {
        ev.stopPropagation();
        box.remove();
        this.opts.onMove && this.opts.onMove({ from, to, promotion: p });
      });
      box.appendChild(b);
    }
    const cancel = div('cb-promo-cancel');
    cancel.textContent = '✕';
    cancel.addEventListener('pointerdown', ev => {
      ev.stopPropagation();
      box.remove();
      if (dropped) this.placePiece(this.pieces.get(from).el, from);
    });
    box.appendChild(cancel);
    this.promoEl = box;
    this.el.appendChild(box);
  }
}

function div(cls) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
