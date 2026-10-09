import { loadSettings, saveSettings } from './settings.js';
import { getPuzzles, getPuzzleStats } from './storage.js';
import { parseGameUrl } from './chesscom.js';
import { hydrateIcons } from './icons.js';

hydrateIcons();

const $ = id => document.getElementById(id);
const open = path => { chrome.tabs.create({ url: chrome.runtime.getURL(path) }); window.close(); };

(async () => {
  const s = await loadSettings();
  $('intercept').checked = s.intercept !== 'off';
  $('intercept').onchange = e => saveSettings({ intercept: e.target.checked ? 'all' : 'off' });
  $('analyze').onclick = () => open('src/app.html');
  $('puzzles').onclick = () => open('src/puzzles.html');
  $('openings').onclick = () => open('src/openings.html');
  $('explore').onclick = () => open('src/app.html?explore=1');
  $('options').onclick = () => open('src/options.html');
  $('np').textContent = (await getPuzzles()).length;
  $('pr').textContent = Math.round((await getPuzzleStats()).rating);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const g = parseGameUrl(tab?.url);
  if (g && /chess\.com/.test(tab.url)) {
    $('cur').hidden = false;
    $('cur').onclick = () => open(`src/app.html?id=${g.id}&gtype=${g.gtype}`);
  }
})();
