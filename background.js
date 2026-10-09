// Service worker : ouvre l'analyseur et gère le menu contextuel.

const APP = 'src/app.html';

function appUrl(params = {}) {
  const q = new URLSearchParams(params).toString();
  return chrome.runtime.getURL(APP) + (q ? '?' + q : '');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'open-analysis') {
    const url = appUrl({ id: msg.gameId, gtype: msg.gameType || 'live' });
    if (msg.sameTab && sender.tab?.id != null) chrome.tabs.update(sender.tab.id, { url });
    else chrome.tabs.create({ url, index: sender.tab ? sender.tab.index + 1 : undefined });
    sendResponse({ ok: true });
  } else if (msg?.type === 'open-page') {
    chrome.tabs.create({ url: chrome.runtime.getURL(msg.page) });
    sendResponse({ ok: true });
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'analyze-link',
      title: 'Analyser cette partie avec Stockfish',
      contexts: ['link'],
      targetUrlPatterns: ['https://www.chess.com/*game*']
    });
    chrome.contextMenus.create({
      id: 'analyze-page',
      title: 'Analyser cette partie avec Stockfish',
      contexts: ['page'],
      documentUrlPatterns: ['https://www.chess.com/*game*']
    });
  });
});

function parseGameUrl(url) {
  const m = /\/(?:game\/(live|daily)\/|(live|daily)\/game\/|analysis\/game\/(live|daily)\/|game\/)(\d+)/.exec(url || '');
  if (!m) return null;
  return { gameType: m[1] || m[2] || m[3] || 'live', gameId: m[4] };
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const g = parseGameUrl(info.menuItemId === 'analyze-link' ? info.linkUrl : info.pageUrl);
  if (!g) return;
  chrome.tabs.create({ url: appUrl({ id: g.gameId, gtype: g.gameType }), index: tab ? tab.index + 1 : undefined });
});
