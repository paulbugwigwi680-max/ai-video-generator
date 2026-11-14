// A small instrumental beat made entirely with the Web Audio API (no files, no copyright).
// Groove in A minor (Am - F - C - G), 96 BPM: kick, clap, hi-hats, bass, plucked melody and a soft pad.
// The beat lives under the narration: it is full in the silences and ducks low while someone speaks.
// Works with a normal AudioContext (playback) and an OfflineAudioContext (MP4 export).
export type Interval = { start: number; end: number }; // seconds, relative to the start of the beat

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

type Chord = { bass: number; tones: number[] };

export type BeatStyleId = "classic" | "bongo" | "chill" | "epic" | "amapiano" | "calm";

// Every style is made with the Web Audio API only (no files, no copyright).
export const BEAT_STYLES: { id: BeatStyleId; label: string; bpm: number; swing: number; chords: Chord[] }[] = [
  {
    id: "classic",
    label: "Classic: ngoma, bass na gitaa laini (96 BPM)",
    bpm: 96,
    swing: 0,
    chords: [
      { bass: 45, tones: [57, 60, 64] }, // Am
      { bass: 41, tones: [53, 57, 60] }, // F
      { bass: 48, tones: [55, 60, 64] }, // C
      { bass: 43, tones: [55, 59, 62] }, // G
    ],
  },
  {
    id: "bongo",
    label: "Bongo Flava: conga na bass ya kucheza (100 BPM)",
    bpm: 100,
    swing: 0,
    chords: [
      { bass: 38, tones: [50, 53, 57] }, // Dm
      { bass: 34, tones: [50, 53, 58] }, // Bb
      { bass: 41, tones: [48, 53, 57] }, // F
      { bass: 36, tones: [48, 52, 55] }, // C
    ],
  },
  {
    id: "chill",
    label: "Chill: laini ya kutuliza, kama lofi (76 BPM)",
    bpm: 76,
    swing: 0.2,
    chords: [
      { bass: 36, tones: [55, 59, 64] }, // Cmaj7
      { bass: 45, tones: [55, 60, 64] }, // Am7
      { bass: 41, tones: [57, 60, 64] }, // Fmaj7
      { bass: 43, tones: [55, 59, 62] }, // G
    ],
  },
  {
    id: "epic",
    label: "Cinematic: nzito na ya kusisimua, kwa documentary (72 BPM)",
    bpm: 72,
    swing: 0,
    chords: [
      { bass: 38, tones: [50, 53, 57] }, // Dm
      { bass: 34, tones: [53, 58, 62] }, // Bb
      { bass: 43, tones: [55, 58, 62] }, // Gm
      { bass: 45, tones: [52, 57, 61] }, // A
    ],
  },
  {
    id: "amapiano",
    label: "Amapiano: log drum, shaker na piano (112 BPM)",
    bpm: 112,
    swing: 0,
    chords: [
      { bass: 45, tones: [57, 60, 64] }, // Am
      { bass: 41, tones: [57, 60, 65] }, // F
      { bass: 38, tones: [57, 62, 65] }, // Dm
      { bass: 40, tones: [56, 59, 64] }, // E
    ],
  },
  {
    id: "calm",
    label: "Utulivu: piano na pad tu, bila ngoma (66 BPM)",
    bpm: 66,
    swing: 0,
    chords: [
      { bass: 36, tones: [52, 55, 60] }, // C
      { bass: 43, tones: [50, 55, 59] }, // G
      { bass: 45, tones: [52, 57, 60] }, // Am
      { bass: 41, tones: [53, 57, 60] }, // F
    ],
  },
];

const ARP = [0, 1, 2, 1, 2, 1, 0, 2];
const BASS_STEPS = [0, 3, 6, 8, 11, 14];
const BASS_OFFSETS = [0, 0, 7, 0, 12, 7];

export function scheduleBeat(
  ctx: BaseAudioContext,
  out: AudioNode,
  t0: number,
  duration: number,
  speech: Interval[],
  styleId: BeatStyleId = "classic"
) {
  if (duration < 2) return;
  const style = BEAT_STYLES.find((x) => x.id === styleId) ?? BEAT_STYLES[0];
  const CHORDS = style.chords;
  const step = 60 / style.bpm / 4; // one 16th note
  const steps = Math.floor(duration / step);
  const HI = 0.9; // level in the silences
  const LO = 0.32; // level under the voice (still clearly audible, like a music bed)

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
    const fade = Math.min(1, t / 0.25, Math.max(0, (duration - t) / 1.2));
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

  const kick = (t: number, vel = 1) => {
    const o = osc("sine", 190, t, 0.4);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.1);
    const g = env(t, 0.95 * vel, 0.004, 0.3);
    o.connect(g);
    g.connect(bus);
    // short click: small speakers cannot play deep bass, but they do play this
    const n = noise(t, 0.03);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3000;
    bp.Q.value = 1;
    const gc = env(t, 0.4 * vel, 0.001, 0.025);
    n.connect(bp);
    bp.connect(gc);
    gc.connect(bus);
  };
  // conga-like hit: a warm mid-range drum that is easy to hear on any speaker
  const conga = (t: number, hi: boolean) => {
    const f = hi ? 380 : 290;
    const o = osc("sine", f, t, 0.25);
    o.frequency.exponentialRampToValueAtTime(f * 0.78, t + 0.12);
    const g = env(t, 0.45, 0.002, 0.16);
    o.connect(g);
    g.connect(bus);
  };
  const snare = (t: number, vel = 1) => {
    const n = noise(t, 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = env(t, 0.45 * vel, 0.002, 0.16);
    n.connect(bp);
    bp.connect(g);
    g.connect(bus);
    const o = osc("triangle", 190, t, 0.12);
    const g2 = env(t, 0.25 * vel, 0.002, 0.08);
    o.connect(g2);
    g2.connect(bus);
  };
  const hat = (t: number, vel: number, open: boolean) => {
    const n = noise(t, open ? 0.3 : 0.06);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7500;
    const g = env(t, 0.2 * vel, 0.001, open ? 0.22 : 0.04);
    n.connect(hp);
    hp.connect(g);
    g.connect(bus);
  };
  const bass = (t: number, m: number, len: number) => {
    const o = osc("sawtooth", midi(m + 12), t, len + 0.05);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1100;
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
    const g = env(t, 0.24 * vel, 0.004, 0.34);
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

  // ---- extra instruments for the other styles ----
  const piano = (t: number, m: number, vel: number) => {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    const g = env(t, 0.3 * vel, 0.004, 0.9);
    const o1 = osc("sine", midi(m), t, 1.0);
    const o2 = osc("triangle", midi(m) * 2, t, 1.0);
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(bus);
  };
  const logdrum = (t: number, m: number, len: number) => {
    const o = osc("sine", midi(m + 12) * 1.7, t, len + 0.05);
    o.frequency.exponentialRampToValueAtTime(midi(m + 12), t + 0.07);
    const g = env(t, 0.75, 0.003, len);
    o.connect(g);
    g.connect(bus);
  };
  const timp = (t: number, m: number, vel: number) => {
    const o = osc("sine", midi(m) * 1.5, t, 1.1);
    o.frequency.exponentialRampToValueAtTime(midi(m), t + 0.18);
    const g = env(t, 0.9 * vel, 0.004, 0.9);
    o.connect(g);
    g.connect(bus);
    const n = noise(t, 0.05);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const gn = env(t, 0.3 * vel, 0.002, 0.05);
    n.connect(lp);
    lp.connect(gn);
    gn.connect(bus);
  };
  const shaker = (t: number, vel: number) => {
    const n = noise(t, 0.07);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 6500;
    bp.Q.value = 1.5;
    const g = env(t, 0.16 * vel, 0.002, 0.05);
    n.connect(bp);
    bp.connect(g);
    g.connect(bus);
  };
  const strings = (t: number, tones: number[], len: number) => {
    for (const m of tones) {
      for (const det of [-9, 9]) {
        const o = osc("sawtooth", midi(m), t, len + 1.2);
        o.detune.value = det;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1400;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.9);
        g.gain.setValueAtTime(0.05, t + len);
        g.gain.linearRampToValueAtTime(0.0001, t + len + 1.1);
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
    const lastOfFour = b % 4 === 3;

    if (style.id === "epic") strings(bt, chord.tones, barLen);
    else if (style.id === "calm") pad(bt, chord.tones, barLen);
    else if (style.id !== "amapiano") pad(bt, chord.tones, barLen);

    for (let s = 0; s < 16; s++) {
      if (b * 16 + s >= steps) break;
      const t = bt + s * step + (s % 2 ? step * style.swing : 0);

      switch (style.id) {
        case "classic": {
          if (s % 2 === 0) pluck(t, chord.tones[ARP[s / 2]] + 12, s % 4 === 0 ? 1 : 0.7);
          if (s === 0 || s === 7 || s === 10) kick(t);
          if (s === 4 || s === 12) snare(t);
          if (s % 2 === 0) hat(t, s % 4 === 0 ? 1 : 0.6, false);
          else hat(t, 0.35, false);
          if (s === 14) hat(t, 1, true);
          if (s === 3 || s === 11) conga(t, false);
          if (s === 6 || s === 14) conga(t, true);
          const k = BASS_STEPS.indexOf(s);
          if (k >= 0) bass(t, chord.bass + BASS_OFFSETS[k], step * 2.4);
          break;
        }
        case "bongo": {
          if (s === 0 || s === 6 || s === 10) kick(t, 0.9);
          if (s === 4 || s === 12) snare(t, 0.55);
          if (s % 2 === 0) hat(t, 0.5, false);
          if (s === 3 || s === 8 || s === 11) conga(t, false);
          if (s === 2 || s === 6 || s === 14 || s === 15) conga(t, true);
          if (s === 0 || s === 3 || s === 6 || s === 10) bass(t, chord.bass + (s === 6 ? 7 : 0), step * 2.2);
          if (s % 4 === 2) pluck(t, chord.tones[(s / 2) % 3] + 12, 0.7);
          if (s === 7 || s === 15) pluck(t, chord.tones[2] + 24, 0.6);
          break;
        }
        case "chill": {
          if (s === 0 || s === 10) kick(t, 0.8);
          if (s === 4 || s === 12) snare(t, 0.4);
          if (s % 2 === 0) hat(t, 0.3, false);
          if (s === 0) chord.tones.forEach((m) => piano(t, m, 0.7));
          if (s === 6 || s === 10 || s === 14) piano(t, chord.tones[(s / 2) % 3] + 12, 0.6);
          if (s === 0 || s === 10) bass(t, chord.bass, step * 3);
          break;
        }
        case "epic": {
          if (s === 0) timp(t, chord.bass, 1);
          if (s === 8) timp(t, chord.bass + 7, 0.6);
          if (lastOfFour && (s === 12 || s === 14)) timp(t, chord.bass + 12, 0.7);
          if (s === 0 || s === 8) bass(t, chord.bass, step * 6);
          if (s % 4 === 0) piano(t, chord.tones[(s / 4) % 3] + 12, 0.45);
          break;
        }
        case "amapiano": {
          if (s % 4 === 0) kick(t, 0.75);
          if (s === 4 || s === 12) snare(t, 0.35);
          shaker(t, s % 2 ? 1 : 0.5);
          if (s === 0 || s === 3 || s === 6 || s === 10 || s === 13) logdrum(t, chord.bass + (s === 6 ? 7 : 0), step * 2.2);
          if (s === 2 || s === 5 || s === 8 || s === 11 || s === 14) {
            chord.tones.forEach((m) => piano(t, m + 12, 0.35));
          }
          break;
        }
        case "calm": {
          if (s === 0) bass(t, chord.bass, step * 8);
          if (s === 0 || s === 3 || s === 6 || s === 8 || s === 11 || s === 14) {
            const idx = [0, 3, 6, 8, 11, 14].indexOf(s);
            piano(t, chord.tones[[0, 1, 2, 1, 2, 1][idx]] + 12, 0.55);
          }
          break;
        }
      }
    }
  }
}
