// Sons synthétisés (WebAudio) : aucun fichier audio requis.
let ctx = null;
let volume = 0.6;
let enabled = true;

export function configureSound({ sound, volume: v }) {
  enabled = sound !== false;
  if (v != null) volume = v;
}

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function knock(t0, { freq = 180, decay = 0.07, gain = 0.9, noise = 0.6 } = {}) {
  const a = ac();
  const g = a.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain * volume, t0 + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  g.connect(a.destination);
  // bruit filtré (impact du bois)
  const len = Math.floor(a.sampleRate * decay);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = freq * 6; bp.Q.value = 1.2;
  const ng = a.createGain(); ng.gain.value = noise;
  src.connect(bp).connect(ng).connect(g);
  src.start(t0);
  // corps
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 1.6, t0);
  o.frequency.exponentialRampToValueAtTime(freq, t0 + decay);
  o.connect(g);
  o.start(t0); o.stop(t0 + decay + 0.02);
}

function tone(t0, freq, dur = 0.15, type = 'sine', gain = 0.25) {
  const a = ac();
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain * volume, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

export function play(kind) {
  if (!enabled) return;
  try {
    const t = ac().currentTime + 0.005;
    switch (kind) {
      case 'move': knock(t); break;
      case 'capture': knock(t, { freq: 140, decay: 0.1, gain: 1, noise: 1 }); break;
      case 'castle': knock(t); knock(t + 0.09, { freq: 200 }); break;
      case 'check': knock(t); tone(t + 0.02, 880, 0.12, 'triangle', 0.18); break;
      case 'promote': knock(t); tone(t + 0.03, 660, 0.1, 'triangle', 0.15); tone(t + 0.1, 990, 0.14, 'triangle', 0.15); break;
      case 'end': tone(t, 523, 0.25); tone(t + 0.12, 659, 0.25); tone(t + 0.24, 784, 0.4); break;
      case 'success': tone(t, 660, 0.12, 'triangle'); tone(t + 0.1, 990, 0.25, 'triangle'); break;
      case 'error': tone(t, 220, 0.18, 'square', 0.12); tone(t + 0.12, 180, 0.22, 'square', 0.12); break;
      case 'notify': tone(t, 880, 0.12, 'sine', 0.2); break;
    }
  } catch {}
}

/** Choisit le son adapté à un coup (objet move de chess.js / annotation). */
export function playForMove(m, inCheck) {
  if (!m) return;
  if (inCheck) return play('check');
  if (m.promotion) return play('promote');
  if (m.flags && (m.flags.includes('k') || m.flags.includes('q'))) return play('castle');
  if (m.captured) return play('capture');
  play('move');
}
