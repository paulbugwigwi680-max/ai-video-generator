// Helpers that keep the narration clean: no clicks, no hiss, no stray noise at the edges.
export type Narration = { buf: AudioBuffer; off: number; dur: number };

// Cleans one narration:
//  - finds where the speech really starts and ends (cuts silence at both ends),
//  - removes short hissy / whistling bursts ("chiiii", static) that text-to-speech sometimes
//    leaves after the last word,
//  - gates the quiet noise floor between words so only clean speech remains.
export function analyzeNarration(buf: AudioBuffer): Narration {
  const rate = buf.sampleRate;
  const x = buf.getChannelData(0);
  const n = x.length;
  const win = Math.max(1, Math.round(rate * 0.01)); // 10 ms frames
  const frames = Math.ceil(n / win);

  // loudness (rms) and "hissiness" (zero crossings per sample) of every frame
  const rms = new Float32Array(frames);
  const zcr = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = f * win;
    const b = Math.min(n, a + win);
    let s = 0;
    let z = 0;
    for (let i = a; i < b; i++) {
      s += x[i] * x[i];
      if (i > a && x[i] >= 0 !== x[i - 1] >= 0) z++;
    }
    const len = Math.max(1, b - a);
    rms[f] = Math.sqrt(s / len);
    zcr[f] = z / len;
  }

  // reference loudness = the loud parts of the speech (90th percentile)
  const sorted = Array.from(rms).sort((p, q) => p - q);
  const ref = sorted[Math.floor(sorted.length * 0.9)] || 0;
  if (ref < 0.003) return { buf, off: 0, dur: buf.duration };
  const thr = Math.max(0.004, ref * 0.1);

  // active frames; short holes (< 120 ms) are closed so words are not chopped
  const active = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) active[f] = rms[f] >= thr ? 1 : 0;
  for (let f = 0; f < frames; ) {
    if (active[f]) {
      f++;
      continue;
    }
    let g = f;
    while (g < frames && !active[g]) g++;
    if (f > 0 && g < frames && g - f <= 12) for (let k = f; k < g; k++) active[k] = 1;
    f = g;
  }

  // speech segments
  const segs: { a: number; b: number }[] = [];
  for (let f = 0; f < frames; ) {
    if (!active[f]) {
      f++;
      continue;
    }
    let g = f;
    while (g < frames && active[g]) g++;
    segs.push({ a: f, b: g });
    f = g;
  }
  if (!segs.length) return { buf, off: 0, dur: buf.duration };

  // drop hissy bursts that come after the speech (separated by a clear gap)
  while (segs.length > 1) {
    const last = segs[segs.length - 1];
    const prev = segs[segs.length - 2];
    const gap = (last.a - prev.b) * 0.01;
    const length = (last.b - last.a) * 0.01;
    let z = 0;
    for (let f = last.a; f < last.b; f++) z += zcr[f];
    z /= last.b - last.a;
    if (gap >= 0.15 && length <= 0.8 && z > 0.18) segs.pop();
    else break;
  }
  const first = segs[0].a;
  const end = segs[segs.length - 1].b;

  // gate: open slightly before speech, close slowly after it
  const target = new Float32Array(frames);
  for (let f = first; f < end; f++) target[f] = active[f] ? 1 : 0;
  const rise = new Float32Array(frames);
  for (let f = frames - 1; f >= 0; f--) rise[f] = Math.max(target[f], (rise[f + 1] ?? 0) - 0.35);
  const gain = new Float32Array(frames);
  for (let f = 0; f < frames; f++) gain[f] = Math.max(rise[f], (gain[f - 1] ?? 0) - 0.12);

  const clean = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: rate });
  const y = clean.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const f = Math.floor(i / win);
    const k = Math.min(frames - 1, f + 1);
    const t = (i - f * win) / win;
    y[i] = x[i] * (gain[f] + (gain[k] - gain[f]) * t);
  }

  const startSec = (first * win) / rate;
  const endSec = (end * win) / rate;
  const off = Math.max(0, startSec - 0.04);
  const stop = Math.min(buf.duration, endSec + 0.1);
  return { buf: clean, off, dur: Math.max(0.3, stop - off) };
}

// Plays a narration with a short fade-in and a longer fade-out (prevents clicks).
// Works with a normal AudioContext and with an OfflineAudioContext (used for MP4 export).
export function playFaded(ctx: BaseAudioContext, out: AudioNode, n: Narration, when: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = n.buf;
  const g = ctx.createGain();
  const fin = 0.03;
  const fout = Math.min(0.15, n.dur / 3);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(1, when + fin);
  g.gain.setValueAtTime(1, when + n.dur - fout);
  g.gain.linearRampToValueAtTime(0, when + n.dur);
  src.connect(g);
  g.connect(out);
  src.start(when, n.off, n.dur);
  return src;
}

// Master output: high-pass filter (removes rumble) and a limiter (voice + beat never distort).
export function makeMaster(ctx: BaseAudioContext, rec: MediaStreamAudioDestinationNode | null): GainNode {
  const master = ctx.createGain();
  master.gain.value = 0.92;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 60;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  master.connect(hp);
  hp.connect(limiter);
  limiter.connect(ctx.destination);
  if (rec) limiter.connect(rec);
  return master;
}

// Fades everything out smoothly so the audio never ends abruptly.
export function fadeOutMaster(master: GainNode, at: number, seconds: number) {
  master.gain.setValueAtTime(master.gain.value, at);
  master.gain.linearRampToValueAtTime(0, at + seconds);
}
