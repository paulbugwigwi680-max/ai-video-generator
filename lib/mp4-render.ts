import { ArrayBufferTarget, Muxer } from "mp4-muxer";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Renders a canvas animation plus (optional) audio into a real MP4 file, frame by frame,
// using the browser's WebCodecs. Nothing is recorded in real time, so the result is exact:
// no recorder glitches, no noise at the end.

const api = () => window as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function canExportMp4(): boolean {
  const g = api();
  return typeof g.VideoEncoder !== "undefined" && typeof g.VideoFrame !== "undefined";
}

export type Mp4Options = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  duration: number; // seconds
  fps?: number;
  audio: AudioBuffer | null; // mono, 48000 Hz
  drawAt: (t: number) => Promise<void> | void; // draw the frame for time t onto the canvas
  onProgress?: (pct: number) => void;
};

export async function renderMp4(o: Mp4Options): Promise<Blob> {
  const g = api();
  const fps = o.fps ?? 30;
  const frames = Math.max(1, Math.round(o.duration * fps));

  // Pick an H.264 configuration this browser can encode.
  let videoCfg: any = null;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42002a", "avc1.42001f"]) {
    const cfg = { codec, width: o.width, height: o.height, bitrate: 6_000_000, framerate: fps, latencyMode: "quality" };
    try {
      const s = await g.VideoEncoder.isConfigSupported(cfg);
      if (s?.supported) {
        videoCfg = cfg;
        break;
      }
    } catch {
      /* try the next one */
    }
  }
  if (!videoCfg) throw new Error("Kivinjari hiki hakiwezi kutengeneza MP4.");

  // AAC audio (needed for sound inside an MP4).
  let audioCfg: any = null;
  if (o.audio) {
    const cfg = { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 1, bitrate: 128_000 };
    try {
      const s = typeof g.AudioEncoder !== "undefined" ? await g.AudioEncoder.isConfigSupported(cfg) : null;
      if (s?.supported) audioCfg = cfg;
    } catch {
      /* unsupported */
    }
    if (!audioCfg) throw new Error("AAC_UNSUPPORTED");
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: o.width, height: o.height },
    ...(audioCfg ? { audio: { codec: "aac", numberOfChannels: 1, sampleRate: 48000 } } : {}),
    fastStart: "in-memory",
  } as any);

  let failure: unknown = null;

  // ---- video ----
  const venc = new g.VideoEncoder({
    output: (chunk: any, meta: any) => (muxer as any).addVideoChunk(chunk, meta),
    error: (e: unknown) => {
      failure = e;
    },
  });
  venc.configure(videoCfg);

  for (let i = 0; i < frames; i++) {
    if (failure) throw failure;
    await o.drawAt(i / fps);
    const frame = new g.VideoFrame(o.canvas, {
      timestamp: Math.round((i * 1e6) / fps),
      duration: Math.round(1e6 / fps),
    });
    venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 8) await sleep(4);
    if (i % 5 === 0) {
      o.onProgress?.(Math.round((i / frames) * 92));
      await sleep(0);
    }
  }
  await venc.flush();
  venc.close();

  // ---- audio ----
  if (audioCfg && o.audio) {
    const aenc = new g.AudioEncoder({
      output: (chunk: any, meta: any) => (muxer as any).addAudioChunk(chunk, meta),
      error: (e: unknown) => {
        failure = e;
      },
    });
    aenc.configure(audioCfg);
    const data = o.audio.getChannelData(0);
    const step = 4800;
    for (let off = 0; off < data.length; off += step) {
      const slice = data.slice(off, Math.min(data.length, off + step));
      const ad = new g.AudioData({
        format: "f32-planar",
        sampleRate: 48000,
        numberOfFrames: slice.length,
        numberOfChannels: 1,
        timestamp: Math.round((off / 48000) * 1e6),
        data: slice,
      });
      aenc.encode(ad);
      ad.close();
      while (aenc.encodeQueueSize > 8) await sleep(4);
    }
    await aenc.flush();
    aenc.close();
  }
  if (failure) throw failure;

  (muxer as any).finalize();
  o.onProgress?.(100);
  return new Blob([target.buffer], { type: "video/mp4" });
}
