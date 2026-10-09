// Interface UCI vers Stockfish (WASM, Web Worker) + pool de moteurs.
import { ENGINES } from './settings.js';

export function parseInfo(line) {
  const t = line.split(' ');
  if (t[0] !== 'info') return null;
  const o = { multipv: 1 };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': o.depth = +t[++i]; break;
      case 'seldepth': o.seldepth = +t[++i]; break;
      case 'multipv': o.multipv = +t[++i]; break;
      case 'nodes': o.nodes = +t[++i]; break;
      case 'nps': o.nps = +t[++i]; break;
      case 'time': o.time = +t[++i]; break;
      case 'hashfull': o.hashfull = +t[++i]; break;
      case 'score':
        o.scoreType = t[++i];
        o.scoreValue = +t[++i];
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') o.bound = t[++i];
        break;
      case 'wdl': o.wdl = [+t[++i], +t[++i], +t[++i]]; break;
      case 'pv': o.pv = t.slice(i + 1); i = t.length; break;
      case 'string': i = t.length; break;
    }
  }
  return o;
}

/** Convertit un score UCI (point de vue du trait) en score point de vue des Blancs. */
export function normScore(type, value, turn) {
  const sign = turn === 'w' ? 1 : -1;
  if (type === 'mate') {
    if (value === 0) return { cp: null, mate: 0, mated: turn };
    return { cp: null, mate: value * sign };
  }
  return { cp: value * sign, mate: null };
}

export class Engine {
  constructor(flavor = 'lite-single') {
    let def = ENGINES[flavor] || ENGINES['lite-single'];
    if (def.mt && !self.crossOriginIsolated) def = ENGINES['lite-single'];
    this.def = def;
    this.isMT = def.mt;
    this.listeners = new Set();
    this.searching = false;
    this.queue = Promise.resolve();
    this.dead = false;
    this.worker = new Worker(chrome.runtime.getURL('engine/' + def.file));
    this.worker.onmessage = e => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (!line) return;
      for (const l of [...this.listeners]) l(line);
    };
    this.worker.onerror = e => {
      console.error('[engine]', e.message || e);
      this.error = e.message || 'Erreur moteur';
    };
  }

  send(cmd) { if (!this.dead) this.worker.postMessage(cmd); }

  waitFor(pred, timeout = 0) {
    return new Promise((resolve, reject) => {
      let timer;
      const fn = line => {
        if (pred(line)) {
          this.listeners.delete(fn);
          clearTimeout(timer);
          resolve(line);
        }
      };
      this.listeners.add(fn);
      if (timeout) timer = setTimeout(() => { this.listeners.delete(fn); reject(new Error('Délai moteur dépassé')); }, timeout);
    });
  }

  async init({ hash = 32, threads = 1 } = {}) {
    const ok = this.waitFor(l => l === 'uciok', 120000);
    this.send('uci');
    await ok;
    this.send(`setoption name Hash value ${hash}`);
    if (this.isMT) this.send(`setoption name Threads value ${Math.max(1, threads)}`);
    await this.ready();
    return this;
  }

  async ready() {
    const p = this.waitFor(l => l === 'readyok', 120000);
    this.send('isready');
    await p;
  }

  newGame() { this.send('ucinewgame'); }

  stop() { if (this.searching) this.send('stop'); }

  /**
   * Analyse une position. Résout avec { lines: [{multipv, depth, score, pv}], bestmove, depth }.
   * Les scores sont normalisés du point de vue des Blancs.
   */
  analyse(fen, { depth = 18, movetime = 0, multipv = 1, onInfo = null } = {}) {
    const run = () => new Promise(resolve => {
      const turn = fen.split(' ')[1] || 'w';
      const lines = [];
      let maxDepth = 0;
      this.searching = true;
      const fn = line => {
        if (line.startsWith('info ') && line.includes(' pv ') || line.startsWith('info depth 0')) {
          const o = parseInfo(line);
          if (!o || o.scoreType == null) return;
          if (o.bound && lines[o.multipv - 1]) return;
          const entry = {
            multipv: o.multipv, depth: o.depth || 0, seldepth: o.seldepth,
            score: normScore(o.scoreType, o.scoreValue, turn),
            pv: o.pv || [], nodes: o.nodes, nps: o.nps, time: o.time,
          };
          lines[o.multipv - 1] = entry;
          if (o.multipv === 1) maxDepth = entry.depth;
          onInfo && onInfo({ lines: lines.filter(Boolean), depth: maxDepth, fen });
        } else if (line.startsWith('bestmove')) {
          this.listeners.delete(fn);
          this.searching = false;
          const bm = line.split(' ')[1];
          resolve({ fen, lines: lines.filter(Boolean), bestmove: bm && bm !== '(none)' ? bm : null, depth: maxDepth });
        }
      };
      this.listeners.add(fn);
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      if (movetime) this.send(`go movetime ${movetime}`);
      else if (depth) this.send(`go depth ${depth}`);
      else this.send('go infinite');
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  terminate() {
    this.dead = true;
    try { this.worker.terminate(); } catch {}
    this.listeners.clear();
  }
}

/** Plusieurs moteurs mono-thread qui analysent des positions en parallèle. */
export class EnginePool {
  constructor(size, flavor, opts = {}) {
    this.size = Math.max(1, size);
    this.flavor = flavor;
    this.opts = opts;
    this.engines = [];
    this.cancelled = false;
  }

  async init() {
    for (let i = 0; i < this.size; i++) this.engines.push(new Engine(this.flavor));
    await Promise.all(this.engines.map(e => e.init({ hash: this.opts.hash || 16, threads: 1 })));
    this.engines.forEach(e => e.newGame());
    return this;
  }

  /** Applique fn(engine, task, index) à chaque tâche, en parallèle sur le pool. */
  async run(tasks, fn) {
    const results = new Array(tasks.length);
    let next = 0;
    const worker = async engine => {
      while (!this.cancelled) {
        const i = next++;
        if (i >= tasks.length) return;
        results[i] = await fn(engine, tasks[i], i);
      }
    };
    await Promise.all(this.engines.map(worker));
    return results;
  }

  cancel() {
    this.cancelled = true;
    this.engines.forEach(e => e.stop());
  }

  terminate() {
    this.cancelled = true;
    this.engines.forEach(e => e.terminate());
    this.engines = [];
  }
}

/** Analyse en continu de la position affichée, ne garde que la dernière demande. */
export class LiveAnalyzer {
  constructor(engine, onUpdate) {
    this.engine = engine;
    this.onUpdate = onUpdate;
    this.wanted = null;
    this.running = false;
    this.opts = { depth: 22, multipv: 3 };
  }

  request(fen, opts) {
    this.wanted = { fen, opts: { ...this.opts, ...(opts || {}) } };
    if (this.running) this.engine.stop();
    else this._loop();
  }

  stop() {
    this.wanted = null;
    this.engine.stop();
  }

  async _loop() {
    this.running = true;
    while (this.wanted) {
      const job = this.wanted;
      this.wanted = null;
      const res = await this.engine.analyse(job.fen, {
        ...job.opts,
        onInfo: info => { if (!this.wanted) this.onUpdate(info, false); },
      });
      if (!this.wanted) this.onUpdate(res, true);
    }
    this.running = false;
  }
}
