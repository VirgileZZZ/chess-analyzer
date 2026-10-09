import { hydrateIcons } from './icons.js';
import { renderSettings } from './settings-ui.js';
let t;
renderSettings(document.getElementById('form'), () => {
  const el = document.getElementById('saved');
  el.classList.add('on');
  clearTimeout(t);
  t = setTimeout(() => el.classList.remove('on'), 1200);
});
hydrateIcons();
