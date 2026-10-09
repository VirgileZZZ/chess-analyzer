// Script injecté sur chess.com : intercepte « Bilan de la partie » / « Analyse »
// et ouvre l'analyseur Stockfish de l'extension à la place.
(() => {
  'use strict';

  let settings = { intercept: 'all', openIn: 'newtab', floatingButton: true };
  chrome.storage.local.get('settings').then(r => {
    settings = Object.assign(settings, r.settings || {});
    refreshFloating();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.settings) {
      settings = Object.assign(settings, ch.settings.newValue || {});
      refreshFloating();
    }
  });

  const GAME_RE = /\/(?:game\/(live|daily)\/|(live|daily)\/game\/|analysis\/game\/(live|daily)\/|game\/)(\d+)/;
  const REVIEW_PAGE_RE = /\/analysis\/game\/(live|daily)\/(\d+)|\/game-review\//;
  const LABEL_RE = /^(game review|bilan de la partie|bilan|analy[sz]e|analyser|analysis|review|revoir la partie|revue de partie|analyse de la partie)$/i;

  function parseGame(url) {
    const m = GAME_RE.exec(url || '');
    if (!m) return null;
    return { gameType: m[1] || m[2] || m[3] || 'live', gameId: m[4] };
  }

  function open(game) {
    if (!game) return;
    chrome.runtime.sendMessage({ type: 'open-analysis', ...game, sameTab: settings.openIn === 'sametab' });
  }

  function isAnalyzeControl(el) {
    const href = el.getAttribute('href') || '';
    if (/\/analysis\/game\/|game-review|tab=review/.test(href)) return true;
    const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
    if (LABEL_RE.test(text)) return true;
    const attrs = [el.getAttribute('data-cy'), el.getAttribute('aria-label'), el.className && String(el.className)].join(' ').toLowerCase();
    return /game-review|review-button|analysis-button|analyze-button/.test(attrs);
  }

  // Interception en phase de capture pour passer avant les handlers de chess.com.
  function onClick(e) {
    if (e.altKey) { sessionStorage.setItem('cax-bypass', String(Date.now())); return; }
    if (settings.intercept === 'off' || e.button !== 0) return;
    const el = e.target.closest && e.target.closest('a, button, [role="button"]');
    if (!el || el.closest('.cax-float')) return;
    if (!isAnalyzeControl(el)) return;
    if (el.closest('nav, .nav-component, .sidebar, [class*="nav-menu"]')) return;
    const game = parseGame(el.getAttribute('href') || '') || parseGame(location.href);
    if (!game) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    open(game);
  }
  window.addEventListener('click', onClick, true);

  // Filet de sécurité : si chess.com navigue quand même vers sa page d'analyse.
  let lastUrl = '';
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    refreshFloating();
    if (settings.intercept !== 'all') return;
    if (Date.now() - Number(sessionStorage.getItem('cax-bypass') || 0) < 15000) return;
    if (REVIEW_PAGE_RE.test(location.pathname) && !sessionStorage.getItem('cax-skip-' + location.pathname)) {
      const g = parseGame(location.href);
      if (g) {
        sessionStorage.setItem('cax-skip-' + location.pathname, '1');
        open(g);
      }
    }
  }, 400);

  // Bouton flottant
  let floatEl = null;
  function refreshFloating() {
    if (!document.body) return void document.addEventListener('DOMContentLoaded', refreshFloating, { once: true });
    const game = parseGame(location.href);
    const want = settings.floatingButton && !!game;
    if (!want) { floatEl?.remove(); floatEl = null; return; }
    if (!floatEl) {
      floatEl = document.createElement('button');
      floatEl.className = 'cax-float';
      floatEl.title = 'Analyser cette partie avec Stockfish (extension)';
      const img = document.createElement('img');
      img.src = chrome.runtime.getURL('icons/icon48.png');
      const span = document.createElement('span');
      span.textContent = 'Analyser';
      floatEl.append(img, span);
      floatEl.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        open(parseGame(location.href));
      });
      document.body.appendChild(floatEl);
    }
  }
})();
