// A small instrumental beat made entirely with the Web Audio API (no files, no copyright).
// Groove in A minor (Am - F - C - G), 96 BPM: kick, clap, hi-hats, bass, plucked melody and a soft pad.
// The beat lives under the narration: it is full in the silences and ducks low while someone speaks.
// Works with a normal AudioContext (playback) and an OfflineAudioContext (MP4 export).
export type Interval = { start: number; end: number }; // seconds, relative to the start of the beat

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

const CHORDS = [
  { bass: 45, tones: [57, 60, 64] }, // Am
  { bass: 41, tones: [53, 57, 60] }, // F
  { bass: 48, tones: [55, 60, 64] }, // C
  { bass: 43, tones: [55, 59, 62] }, // G
];
const ARP = [0, 1, 2, 1, 2, 1, 0, 2];
const BASS_STEPS = [0, 3, 6, 8, 11, 14];
const BASS_OFFSETS = [0, 0, 7, 0, 12, 7];

export function scheduleBeat(
  ctx: BaseAudioContext,
  out: AudioNode,
  t0: number,
  duration: number,
  speech: Interval[]
) {
  if (duration < 2) return;
  const step = 60 / 96 / 4; // one 16th note
  const steps = Math.floor(duration / step);
  const HI = 0.55; // level in the silences
  const LO = 0.13; // level under the voice

  // Level bus: its gain curve ducks under speech and fades in/out.
  const bus = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  bus.connect(comp);
  comp.connect(out);

  // Merge sentences that are close together so the beat does not "pump" between them.
  const merged: Interval[] = [];
  for (const iv of [...speech].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && iv.start - last.end < 0.9) last.end = Math.max(last.end, iv.end);
    else merged.push({ ...iv });
  }
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const N = Math.max(2, Math.ceil(duration / 0.05));
  const curve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * duration;
    let duck = 1;
    for (const iv of merged) {
      const down = clamp01((t - (iv.start - 0.3)) / 0.3);
      const up = clamp01((t - iv.end) / 0.6);
      duck = Math.min(duck, 1 - down * (1 - up) * (1 - LO / HI));
    }
    const fade = Math.min(1, t / 1.0, Math.max(0, (duration - t) / 1.4));
    curve[i] = HI * fade * duck;
  }
  bus.gain.setValueCurveAtTime(curve, t0, duration);

  // Shared noise (for snare and hats), generated the same way every time.
  const nl = Math.floor(ctx.sampleRate * 0.4);
  const nb = ctx.createBuffer(1, nl, ctx.sampleRate);
  const nd = nb.getChannelData(0);
  let seed = 22222;
  for (let i = 0; i < nl; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    nd[i] = seed / 2147483648 - 1;
  }

  const osc = (type: OscillatorType, freq: number, t: number, dur: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.start(t);
    o.stop(t + dur);
    return o;
  };
  const env = (t: number, peak: number, attack: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  };
  const noise = (t: number, dur: number) => {
    const s = ctx.createBufferSource();
    s.buffer = nb;
    s.start(t, 0, Math.min(dur, 0.39));
    return s;
  };

  const kick = (t: number) => {
    const o = osc("sine", 150, t, 0.4);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = env(t, 0.95, 0.004, 0.32);
    o.connect(g);
    g.connect(bus);
  };
  const snare = (t: number) => {
    const n = noise(t, 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = env(t, 0.45, 0.002, 0.16);
    n.connect(bp);
    bp.connect(g);
    g.connect(bus);
    const o = osc("triangle", 190, t, 0.12);
    const g2 = env(t, 0.25, 0.002, 0.08);
    o.connect(g2);
    g2.connect(bus);
  };
  const hat = (t: number, vel: number, open: boolean) => {
    const n = noise(t, open ? 0.3 : 0.06);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7500;
    const g = env(t, 0.14 * vel, 0.001, open ? 0.22 : 0.04);
    n.connect(hp);
    hp.connect(g);
    g.connect(bus);
  };
  const bass = (t: number, m: number, len: number) => {
    const o = osc("sawtooth", midi(m), t, len + 0.05);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    lp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.01);
    g.gain.setValueAtTime(0.4, t + len * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    o.connect(lp);
    lp.connect(g);
    g.connect(bus);
  };
  const pluck = (t: number, m: number, vel: number) => {
    const o = osc("triangle", midi(m), t, 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + 0.3);
    const g = env(t, 0.17 * vel, 0.004, 0.34);
    o.connect(lp);
    lp.connect(g);
    g.connect(bus);
  };
  const pad = (t: number, tones: number[], len: number) => {
    for (const m of tones) {
      for (const det of [-7, 7]) {
        const o = osc("sawtooth", midi(m), t, len + 0.7);
        o.detune.value = det;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035, t + 0.4);
        g.gain.setValueAtTime(0.035, t + len);
        g.gain.linearRampToValueAtTime(0.0001, t + len + 0.6);
        o.connect(lp);
        lp.connect(g);
        g.connect(bus);
      }
    }
  };

  const barLen = step * 16;
  const bars = Math.ceil(steps / 16);
  for (let b = 0; b < bars; b++) {
    const chord = CHORDS[b % 4];
    const bt = t0 + b * barLen;
    pad(bt, chord.tones, barLen);
    for (let s = 0; s < 16; s++) {
      if (b * 16 + s >= steps) break;
      const t = bt + s * step;
      if (s % 2 === 0) pluck(t, chord.tones[ARP[s / 2]] + 12, s % 4 === 0 ? 1 : 0.7);
      if (b >= 1) {
        if (s === 0 || s === 7 || s === 10) kick(t);
        if (s === 4 || s === 12) snare(t);
        if (s % 2 === 0) hat(t, s % 4 === 0 ? 1 : 0.6, false);
        else hat(t, 0.35, false);
        if (s === 14) hat(t, 1, true);
        const k = BASS_STEPS.indexOf(s);
        if (k >= 0) bass(t, chord.bass + BASS_OFFSETS[k], step * 2.4);
      } else if (s === 0) {
        bass(t, chord.bass, barLen * 0.9);
      }
    }
  }
}
