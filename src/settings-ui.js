// Formulaire de paramètres (utilisé dans la fenêtre modale et la page d'options).
import { icon } from './icons.js';
import { DEFAULTS, BOARD_THEMES, PIECE_SETS, ENGINES, loadSettings, saveSettings, resetSettings, engineAvailable } from './settings.js';

const opt = o => Object.entries(o).map(([value, label]) => ({ value, label }));

export const SECTIONS = [
  {
    title: 'Moteur Stockfish', icon: 'gear', fields: [
      { key: 'engine', label: 'Version du moteur', type: 'select', options: Object.entries(ENGINES).map(([value, e]) => ({ value, label: e.name })) },
      { key: 'searchMode', label: 'Mode de recherche', type: 'select', options: opt({ depth: 'Profondeur fixe', time: 'Temps fixe par position' }) },
      { key: 'depth', label: 'Profondeur du bilan', type: 'range', min: 8, max: 30, step: 1, show: s => s.searchMode === 'depth', hint: '18 ≈ rapide et fiable, 22+ = plus précis mais plus lent' },
      { key: 'movetime', label: 'Temps par position (ms)', type: 'range', min: 100, max: 10000, step: 100, show: s => s.searchMode === 'time' },
      { key: 'workers', label: 'Moteurs en parallèle (bilan)', type: 'range', min: 1, max: Math.max(2, navigator.hardwareConcurrency || 4), step: 1, hint: 'Plus = analyse plus rapide (utilise plus de CPU / RAM)' },
      { key: 'hash', label: 'Mémoire de hachage par moteur (Mo)', type: 'range', min: 8, max: 512, step: 8 },
      { key: 'threads', label: 'Threads (analyse en direct, version multi-thread)', type: 'range', min: 1, max: Math.max(1, navigator.hardwareConcurrency || 4), step: 1, show: s => s.engine === 'lite-mt' },
      { key: 'liveEngine', label: 'Analyse en direct activée par défaut', type: 'toggle' },
      { key: 'liveDepth', label: 'Profondeur de l\'analyse en direct', type: 'range', min: 10, max: 40, step: 1 },
      { key: 'multipv', label: 'Nombre de lignes affichées', type: 'range', min: 1, max: 5, step: 1 },
    ],
  },
  {
    title: 'Classification des coups', icon: 'star', fields: [
      { key: 'strictness', label: 'Sévérité', type: 'select', options: opt({ lenient: 'Indulgente', normal: 'Normale (chess.com)', strict: 'Sévère' }) },
      { key: 'enableBrilliant', label: 'Détecter les coups brillants (!!)', type: 'toggle' },
      { key: 'brilliantPawnSacs', label: 'Compter les sacrifices de pion comme brillants', type: 'toggle' },
      { key: 'blunderNeedsMaterial', label: 'Gaffe (??) seulement en cas de perte de matériel', type: 'toggle', hint: 'Sinon, une grosse erreur positionnelle est notée « Erreur » (?)' },
      { key: 'enableGreat', label: 'Détecter les très bons coups (!)', type: 'toggle' },
      { key: 'enableMiss', label: 'Détecter les occasions manquées', type: 'toggle' },
      { key: 'enableBook', label: 'Détecter les coups théoriques', type: 'toggle' },
    ],
  },
  {
    title: 'Plateau', icon: 'board', fields: [
      { key: 'boardTheme', label: 'Thème', type: 'select', options: Object.entries(BOARD_THEMES).map(([value, t]) => ({ value, label: t.name })) },
      { key: 'pieceSet', label: 'Pièces', type: 'select', options: opt(PIECE_SETS) },
      { key: 'animationMs', label: 'Vitesse d\'animation (ms)', type: 'range', min: 0, max: 500, step: 10 },
      { key: 'showCoords', label: 'Coordonnées', type: 'toggle' },
      { key: 'showArrows', label: 'Flèche du meilleur coup', type: 'toggle' },
      { key: 'showClassIcons', label: 'Icônes de classification sur le plateau', type: 'toggle' },
      { key: 'showEvalBar', label: 'Barre d\'évaluation', type: 'toggle' },
      { key: 'showGraph', label: 'Graphique d\'évaluation', type: 'toggle' },
      { key: 'showClocks', label: 'Pendules / temps par coup', type: 'toggle' },
      { key: 'autoQueen', label: 'Promotion automatique en dame', type: 'toggle' },
      { key: 'sound', label: 'Sons', type: 'toggle' },
      { key: 'volume', label: 'Volume', type: 'range', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Chess.com', icon: 'external', fields: [
      { key: 'username', label: 'Votre pseudo chess.com', type: 'text', placeholder: 'ex : Hikaru', hint: 'Sert à orienter le plateau et à charger vos parties' },
      { key: 'intercept', label: 'Remplacer « Bilan de la partie » / « Analyse »', type: 'select', options: opt({ all: 'Toujours (boutons + pages d\'analyse)', button: 'Seulement les clics sur les boutons', off: 'Jamais (bouton flottant uniquement)' }), hint: 'Astuce : Alt + clic pour ouvrir l\'analyse normale de chess.com' },
      { key: 'openIn', label: 'Ouvrir l\'analyse', type: 'select', options: opt({ newtab: 'Dans un nouvel onglet', sametab: 'Dans le même onglet' }) },
      { key: 'floatingButton', label: 'Bouton flottant « Analyser » sur les parties', type: 'toggle' },
      { key: 'autoFlip', label: 'Orienter le plateau de mon côté', type: 'toggle' },
      { key: 'cacheAnalyses', label: 'Mémoriser les analyses (réouverture instantanée)', type: 'toggle' },
    ],
  },
];

/** Construit le formulaire dans `root`. onChange(settings, key) est appelé à chaque modification. */
export async function renderSettings(root, onChange) {
  let s = await loadSettings();
  root.innerHTML = '';
  root.classList.add('settings-form');
  const rows = [];
  for (const sec of SECTIONS) {
    const box = document.createElement('section');
    box.className = 'set-section';
    box.innerHTML = `<h3><span class="set-ico">${icon(sec.icon, 14)}</span>${sec.title}</h3>`;
    for (const f of sec.fields) {
      const row = document.createElement('label');
      row.className = 'set-row set-' + f.type;
      const lab = document.createElement('div');
      lab.className = 'set-label';
      lab.innerHTML = `<span>${f.label}</span>${f.hint ? `<small>${f.hint}</small>` : ''}`;
      row.appendChild(lab);
      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        for (const o of f.options) {
          if (f.key === 'engine' && !(await engineAvailable(o.value))) continue;
          input.add(new Option(o.label, o.value));
        }
        input.value = s[f.key];
      } else if (f.type === 'toggle') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'toggle';
        input.checked = !!s[f.key];
      } else if (f.type === 'range') {
        const wrap = document.createElement('div');
        wrap.className = 'range-wrap';
        input = document.createElement('input');
        input.type = 'range';
        Object.assign(input, { min: f.min, max: f.max, step: f.step });
        input.value = s[f.key];
        const out = document.createElement('output');
        out.textContent = s[f.key];
        const paint = () => {
          out.textContent = input.value;
          input.style.setProperty('--pct', ((input.value - f.min) / (f.max - f.min) * 100) + '%');
        };
        input.addEventListener('input', paint);
        paint();
        wrap.append(input, out);
        row.appendChild(wrap);
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = f.placeholder || '';
        input.value = s[f.key] || '';
      }
      if (f.type !== 'range') row.appendChild(input);
      input.addEventListener('change', async () => {
        let v = f.type === 'toggle' ? input.checked : input.value;
        if (f.type === 'range') v = +v;
        if (f.type === 'text') v = v.trim();
        s = await saveSettings({ [f.key]: v });
        refresh();
        onChange && onChange(s, f.key);
      });
      rows.push({ f, row });
      box.appendChild(row);
    }
    root.appendChild(box);
  }
  const foot = document.createElement('div');
  foot.className = 'set-foot';
  const reset = document.createElement('button');
  reset.className = 'btn btn-ghost';
  reset.textContent = 'Réinitialiser les paramètres';
  reset.addEventListener('click', async () => {
    if (!confirm('Remettre tous les paramètres par défaut ?')) return;
    s = await resetSettings();
    await renderSettings(root, onChange);
    onChange && onChange(s, '*');
  });
  foot.appendChild(reset);
  root.appendChild(foot);
  function refresh() {
    for (const { f, row } of rows) row.hidden = f.show ? !f.show(s) : false;
  }
  refresh();
  return s;
}

export { DEFAULTS };
