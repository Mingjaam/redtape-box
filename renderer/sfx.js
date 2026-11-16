// WebAudio 로 즉석 합성하는 효과음 (파일 없음)
let ctx = null;
let enabled = true;
let master = null;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuf(sec = 1) {
  const c = ac();
  const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
let NB = null;

function noise({ dur = 0.2, type = 'lowpass', freq = 800, q = 0.7, gain = 0.5, attack = 0.005, sweepTo = null, at = 0 }) {
  const c = ac();
  NB ||= noiseBuf(2);
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = NB;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0, Math.random());
  src.stop(t0 + dur + 0.05);
  return { g, t0 };
}

function tone({ freq = 440, to = null, dur = 0.3, type = 'sine', gain = 0.3, at = 0 }) {
  const c = ac();
  const t0 = c.currentTime + at;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

const S = {
  thump() { noise({ dur: 0.18, freq: 260, gain: 0.7 }); tone({ freq: 95, to: 55, dur: 0.16, gain: 0.35 }); },
  drop() { noise({ dur: 0.12, freq: 420, gain: 0.45 }); tone({ freq: 140, to: 80, dur: 0.1, gain: 0.18 }); },
  flap() { noise({ dur: 0.14, type: 'bandpass', freq: 900, sweepTo: 380, q: 0.8, gain: 0.35 }); },
  tape() {
    // 찌이이익 — 빠른 진폭 변조 노이즈
    const { g, t0 } = noise({ dur: 0.85, type: 'bandpass', freq: 2200, sweepTo: 4800, q: 1.4, gain: 0.32, attack: 0.02 });
    for (let i = 0; i < 40; i++) g.gain.setValueAtTime(0.08 + Math.random() * 0.28, t0 + 0.02 + i * 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
  },
  rip() {
    const { g, t0 } = noise({ dur: 0.32, type: 'highpass', freq: 1400, q: 0.5, gain: 0.5 });
    for (let i = 0; i < 14; i++) g.gain.setValueAtTime(0.1 + Math.random() * 0.5, t0 + i * 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
  },
  stamp() { tone({ freq: 120, to: 60, dur: 0.12, gain: 0.45 }); noise({ dur: 0.08, freq: 1800, gain: 0.35 }); },
  pop() { tone({ freq: 420, to: 980, dur: 0.12, gain: 0.16, type: 'triangle' }); },
  print() { noise({ dur: 0.06, type: 'bandpass', freq: 3800, q: 3, gain: 0.08 }); },
  rumble() { noise({ dur: 0.22, freq: 180, gain: 0.25 }); },
  ding() {
    tone({ freq: 1046, dur: 0.9, gain: 0.18 });
    tone({ freq: 1568, dur: 1.1, gain: 0.12, at: 0.12 });
    tone({ freq: 2093, dur: 1.2, gain: 0.08, at: 0.24 });
  },
  sad() { tone({ freq: 392, to: 370, dur: 0.3, gain: 0.15, type: 'triangle' }); tone({ freq: 330, to: 262, dur: 0.6, gain: 0.15, type: 'triangle', at: 0.3 }); },
  hello() { tone({ freq: 660, dur: 0.12, gain: 0.1, type: 'triangle' }); tone({ freq: 880, dur: 0.16, gain: 0.1, type: 'triangle', at: 0.1 }); },
};

export const sfx = new Proxy({}, {
  get(_t, name) {
    if (name === 'setEnabled') return (v) => { enabled = !!v; };
    return (...a) => { if (!enabled || !S[name]) return; try { S[name](...a); } catch { /* 오디오 장치 없음 */ } };
  },
});
