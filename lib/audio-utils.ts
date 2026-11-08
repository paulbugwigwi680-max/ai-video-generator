// Helpers that keep the narration clean: no clicks, no stray noise at the edges.
export type Narration = { buf: AudioBuffer; off: number; dur: number };

// Finds where the speech really starts and ends so leading/trailing silence and tiny artefacts are cut.
export function analyzeNarration(buf: AudioBuffer): Narration {
  const data = buf.getChannelData(0);
  const rate = buf.sampleRate;
  const threshold = 0.012;
  const win = Math.max(1, Math.floor(rate * 0.01)); // 10 ms windows
  const peak = (from: number) => {
    let m = 0;
    const end = Math.min(data.length, from + win);
    for (let i = from; i < end; i++) {
      const a = Math.abs(data[i]);
      if (a > m) m = a;
    }
    return m;
  };
  let first = 0;
  while (first < data.length && peak(first) < threshold) first += win;
  if (first >= data.length) return { buf, off: 0, dur: buf.duration };
  let last = data.length - win;
  while (last > first && peak(last) < threshold) last -= win;
  const off = Math.max(0, first / rate - 0.03);
  const end = Math.min(buf.duration, (last + win) / rate + 0.12);
  return { buf, off, dur: Math.max(0.3, end - off) };
}

// Plays a narration with a short fade-in and a longer fade-out (prevents clicks).
// Works with a normal AudioContext and with an OfflineAudioContext (used for MP4 export).
export function playFaded(ctx: BaseAudioContext, out: AudioNode, n: Narration, when: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = n.buf;
  const g = ctx.createGain();
  const fin = 0.03;
  const fout = Math.min(0.12, n.dur / 3);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(1, when + fin);
  g.gain.setValueAtTime(1, when + n.dur - fout);
  g.gain.linearRampToValueAtTime(0, when + n.dur);
  src.connect(g);
  g.connect(out);
  src.start(when, n.off, n.dur);
  return src;
}

// Master output: slightly lowered level and a high-pass filter that removes rumble.
export function makeMaster(ctx: BaseAudioContext, rec: MediaStreamAudioDestinationNode | null): GainNode {
  const master = ctx.createGain();
  master.gain.value = 0.92;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 60;
  master.connect(hp);
  hp.connect(ctx.destination);
  if (rec) hp.connect(rec);
  return master;
}

// Fades everything out smoothly so the audio never ends abruptly.
export function fadeOutMaster(master: GainNode, at: number, seconds: number) {
  master.gain.setValueAtTime(master.gain.value, at);
  master.gain.linearRampToValueAtTime(0, at + seconds);
}
