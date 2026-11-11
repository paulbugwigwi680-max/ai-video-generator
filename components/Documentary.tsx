"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { pickVoice, voicesFor } from "@/lib/voices";
import { AI_VOICES, DEFAULT_AI_VOICE } from "@/lib/tts-voices";
import { fetchNarration, newAudioContext } from "@/lib/narration-client";
import { uploadToCloudinary } from "@/lib/cloudinary-client";
import { analyzeNarration, fadeOutMaster, finalizeMix, loudness, makeMaster, playFaded, type Narration } from "@/lib/audio-utils";
import { scheduleBeat, type Interval } from "@/lib/beat";
import { blurredBackground, fitRect } from "@/lib/frame-fit";
import { canExportMp4, renderMp4 } from "@/lib/mp4-render";

export type Clip = {
  kind: "video" | "image";
  src: string;
  duration: number;
  caption: string; // text shown on screen for this clip
  speak: string; // full scene narration (set on the first clip of each scene)
  scene: number; // scene number
};

type Media = HTMLImageElement | HTMLVideoElement;

const W = 1280;
const H = 720;
const LEAD = 0.25; // silence before narration starts in each scene
const TAIL = 0.9; // silent, fading-out ending so the file never stops abruptly
const END_FADE = 0.7;

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Stretches each scene so the narration always fits, then computes the timeline.
function buildPlan(clips: Clip[], audio: Map<number, Narration> | null) {
  const out: Clip[] = [];
  const sceneStarts = new Map<number, number>();
  let acc = 0;
  let i = 0;
  while (i < clips.length) {
    const scene = clips[i].scene;
    const group: Clip[] = [];
    while (i < clips.length && clips[i].scene === scene) group.push(clips[i++]);
    const sum = group.reduce((a, c) => a + c.duration, 0);
    const narr = audio?.get(scene);
    const target = narr ? Math.max(sum, narr.dur + LEAD + 0.7) : sum;
    const k = target / sum;
    sceneStarts.set(scene, acc);
    for (const c of group) out.push({ ...c, duration: c.duration * k });
    acc += target;
  }
  if (out.length) out[out.length - 1].duration += TAIL;
  const starts: number[] = [];
  let t = 0;
  for (const c of out) {
    starts.push(t);
    t += c.duration;
  }
  return { clips: out, starts, total: t, sceneStarts };
}

// When does each narration speak? (relative to the start of the video)
function speechIntervals(plan: ReturnType<typeof buildPlan>, audio: Map<number, Narration>): Interval[] {
  const out: Interval[] = [];
  audio.forEach((narr, scene) => {
    const at = plan.sceneStarts.get(scene);
    if (at !== undefined) out.push({ start: at + LEAD, end: at + LEAD + narr.dur });
  });
  return out;
}

function seekVideo(v: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - time) < 0.01 && v.readyState >= 2) {
      resolve();
      return;
    }
    const done = () => {
      v.removeEventListener("seeked", done);
      resolve();
    };
    v.addEventListener("seeked", done);
    v.currentTime = time;
    setTimeout(done, 1500);
  });
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Prepares the AI narration of every scene. One scene failing (busy server, free limit) no longer
// throws away all the other scenes: each scene is retried, and the ones that worked are kept.
async function narrateScenes(
  ctx: BaseAudioContext,
  clips: Clip[],
  voice: string,
  onStep: (n: number, total: number) => void
) {
  const audio = new Map<number, Narration>();
  const scenes = Array.from(new Set(clips.map((c) => c.scene)));
  let failed = 0;
  let lastError = "";
  let n = 0;
  for (const sc of scenes) {
    n++;
    const text = clips.find((c) => c.scene === sc && c.speak)?.speak;
    if (!text) continue;
    onStep(n, scenes.length);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        audio.set(sc, analyzeNarration(await fetchNarration(ctx, text, voice)));
        ok = true;
      } catch (e) {
        lastError = (e as Error).message;
        if (attempt < 2) await sleepMs(1500 * (attempt + 1));
      }
    }
    if (!ok) failed++;
  }
  return { audio, failed, lastError };
}

// Opens the finished MP4 again and checks that its sound track really has sound in it.
async function checkFileSound(blob: Blob): Promise<"ok" | "silent" | "unknown"> {
  try {
    const dec = new OfflineAudioContext(1, 1, 48000);
    const buf = await dec.decodeAudioData(await blob.arrayBuffer());
    return loudness(buf).peak > 0.01 ? "ok" : "silent";
  } catch {
    return "unknown"; // this browser cannot read it back; that does not mean it is silent
  }
}

// Draws one frame of the documentary at time t (seconds). Returns the index of the active clip.
function drawFrame(
  ctx: CanvasRenderingContext2D,
  clips: Clip[],
  starts: number[],
  media: Media[],
  t: number,
  total: number,
  state: { idx: number }
): number {
  let i = clips.findIndex((c, k) => t >= starts[k] && t < starts[k] + c.duration);
  if (i < 0) i = clips.length - 1;
  const clip = clips[i];
  const el = media[i];
  const local = Math.min(1, Math.max(0, (t - starts[i]) / clip.duration));

  if (state.idx !== i) {
    const prev = media[state.idx];
    if (prev instanceof HTMLVideoElement) prev.pause();
    if (el instanceof HTMLVideoElement) {
      el.currentTime = 0;
      el.play().catch(() => {});
    }
    state.idx = i;
  }

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  // People are never cut off: the whole picture is shown (blurred backdrop when the shape differs).
  if (el instanceof HTMLVideoElement) {
    if (el.readyState >= 2 && el.videoWidth) {
      const r = fitRect(el.videoWidth, el.videoHeight, W, H, 1);
      ctx.drawImage(el, r.dx, r.dy, r.dw, r.dh);
    }
  } else if (el && el.complete && el.naturalWidth) {
    const zoom = i % 2 ? 1.05 - 0.05 * local : 1 + 0.05 * local; // very gentle movement
    const r = fitRect(el.naturalWidth, el.naturalHeight, W, H, zoom);
    if (r.contain) ctx.drawImage(blurredBackground(el, W, H), 0, 0);
    ctx.drawImage(el, r.dx, r.dy, r.dw, r.dh);
  }

  // Caption
  const grad = ctx.createLinearGradient(0, H - 200, 0, H);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, H - 200, W, 200);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "600 30px system-ui, sans-serif";
  const lines = wrapText(ctx, clip.caption, W - 160).slice(0, 3);
  lines.forEach((l, k) => ctx.fillText(l, 80, H - 40 - (lines.length - 1 - k) * 42));

  // Brand mark
  ctx.font = "800 20px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.textAlign = "right";
  ctx.fillText("B U G W I G W I", W - 36, 44);
  ctx.textAlign = "left";

  // Fade in from black at the start and out to black at the end.
  const fade = Math.min(1, Math.max(Math.max(0, 1 - t / 0.5), Math.max(0, (t - (total - END_FADE)) / END_FADE)));
  if (fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${fade})`;
    ctx.fillRect(0, 0, W, H);
  }

  return i;
}

export default function Documentary({
  clips,
  title,
  language,
  projectId,
  finalUrl,
}: {
  clips: Clip[];
  title: string;
  language: string;
  projectId: string;
  finalUrl: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRef = useRef<Media[]>([]);
  const cancelRef = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [exportPct, setExportPct] = useState<number | null>(null);
  const [prep, setPrep] = useState("");
  const [msg, setMsg] = useState("");

  // Narration voice + background beat
  const [voiceMode, setVoiceMode] = useState<"ai" | "device">("ai");
  const [aiVoice, setAiVoice] = useState(DEFAULT_AI_VOICE);
  const [beat, setBeat] = useState(true);
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [deviceVoice, setDeviceVoice] = useState("");

  // Sharing (Cloudinary)
  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const [lastName, setLastName] = useState("documentary.mp4");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [shareUrl, setShareUrl] = useState<string | null>(finalUrl);
  const [shareMsg, setShareMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const base = useMemo(() => buildPlan(clips, null), [clips]);

  // Device voices (the list often fills late, so we also listen for changes).
  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    const load = () => {
      voicesRef.current = synth.getVoices();
      setDeviceVoices(voicesFor(voicesRef.current, language));
    };
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, [language]);

  // Preload every picture / clip (crossOrigin keeps the canvas recordable).
  useEffect(() => {
    if (!clips.length) return;
    mediaRef.current = clips.map((c) => {
      if (c.kind === "video") {
        const v = document.createElement("video");
        v.crossOrigin = "anonymous";
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        v.src = c.src;
        return v;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = c.src;
      return img;
    });

    const paint = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawFrame(ctx, base.clips, base.starts, mediaRef.current, 0.6, base.total, { idx: -1 });
    };
    const first = mediaRef.current[0];
    if (first instanceof HTMLImageElement) first.onload = paint;
    else if (first) first.onloadeddata = paint;

    return () => {
      cancelRef.current?.();
    };
  }, [clips, base]);

  function stop() {
    cancelRef.current?.();
  }

  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setLastBlob(blob);
    setLastName(filename);
  }

  const fileBase = () => title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 50) || "documentary";

  async function share() {
    if (!lastBlob || uploading) return;
    setUploading(true);
    setProgress(0);
    setShareMsg("");
    try {
      const url = await uploadToCloudinary(lastBlob, lastName, setProgress);
      const res = await fetch(`/api/projects/${projectId}/final`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Imeshindwa kuhifadhi link.");
      }
      setShareUrl(url);
      setLastBlob(null);
    } catch (e) {
      setShareMsg((e as Error).message);
    }
    setUploading(false);
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareMsg("Nakili link kwa mkono kutoka kwenye kisanduku.");
    }
  }

  // ---------- MP4 export: exact, frame by frame, with clean audio ----------
  async function exportMp4() {
    const canvas = canvasRef.current;
    if (!canvas || !clips.length || busyRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!canExportMp4()) {
      setMsg("Kivinjari hiki hakiwezi kutengeneza MP4 moja kwa moja (tumia Chrome au Edge). Inarekodi kwa njia ya kawaida (WebM).");
      await start(true);
      return;
    }
    busyRef.current = true;
    stop();
    setMsg("");
    setShareMsg("");
    setExportPct(0);

    const notes: string[] = [];
    try {
      // 1. Narration (AI voice). Decoded with an offline context, so nothing plays now.
      let audio = new Map<number, Narration>();
      if (voiceMode === "ai") {
        const dec = new OfflineAudioContext(1, 1, 48000);
        const r = await narrateScenes(dec, clips, aiVoice, (n, t) => setPrep(`Inaandaa sauti ya AI… ${n}/${t}`));
        audio = r.audio;
        setPrep("");
        if (r.failed > 0) {
          notes.push(
            audio.size === 0
              ? `Simulizi ya AI haikupatikana (${r.lastError}).`
              : `Simulizi ya maeneo ${r.failed} haikupatikana (${r.lastError}).`
          );
          notes.push("Bonyeza 'Pakua MP4' tena baada ya muda mfupi: maeneo yaliyofanikiwa hayarudiwi.");
        }
      } else {
        notes.push("Sauti ya kifaa haiwezi kuingia kwenye faili la video. Chagua 'Sauti ya AI' ili simulizi iwemo.");
      }
      const hasNarr = audio.size > 0;
      const plan = buildPlan(clips, hasNarr ? audio : null);

      // 2. Make sure every picture is loaded.
      await Promise.all(
        mediaRef.current.map((m) =>
          m instanceof HTMLImageElement && !m.complete
            ? new Promise<void>((r) => {
                m.onload = () => r();
                m.onerror = () => r();
              })
            : Promise.resolve()
        )
      );

      // 3. Mix narration + beat offline (exact length). The beat no longer depends on the narration:
      //    even if the voice is missing, the file still carries the instrumental from start to end.
      let rendered: AudioBuffer | null = null;
      if (hasNarr || beat) {
        const sr = 48000;
        const off = new OfflineAudioContext(1, Math.ceil(plan.total * sr), sr);
        const master = makeMaster(off, null);
        audio.forEach((narr, scene) => {
          const at = plan.sceneStarts.get(scene);
          if (at !== undefined) playFaded(off, master, narr, at + LEAD);
        });
        if (beat) scheduleBeat(off, master, 0, plan.total, hasNarr ? speechIntervals(plan, audio) : []);
        fadeOutMaster(master, plan.total - END_FADE, END_FADE * 0.8);
        rendered = await off.startRendering();
        finalizeMix(rendered, END_FADE + 0.2); // clean start, smooth end, digital silence at the very end
      } else {
        notes.push("Video hii itatoka bila sauti kwa sababu simulizi na beat vimezimwa.");
      }

      // 4. Render every frame and write the MP4.
      let codec = "aac" as "aac" | "opus";
      const state = { idx: -1 };
      const blob = await renderMp4({
        canvas,
        width: W,
        height: H,
        duration: plan.total,
        audio: rendered,
        onProgress: setExportPct,
        onAudioCodec: (c) => {
          codec = c;
        },
        drawAt: async (t) => {
          let i = plan.clips.findIndex((c, k) => t >= plan.starts[k] && t < plan.starts[k] + c.duration);
          if (i < 0) i = plan.clips.length - 1;
          const el = mediaRef.current[i];
          if (el instanceof HTMLVideoElement) {
            const local = Math.max(0, t - plan.starts[i]);
            await seekVideo(el, Math.min(local, Math.max(0, (el.duration || 0) - 0.05)));
          }
          state.idx = i; // frames are drawn one by one, so no play/pause logic is needed
          drawFrame(ctx, plan.clips, plan.starts, mediaRef.current, Math.min(t, plan.total - 0.001), plan.total, state);
        },
      });
      saveBlob(blob, `${fileBase()}.mp4`);
      drawFrame(ctx, base.clips, base.starts, mediaRef.current, 0.6, base.total, { idx: -1 });

      // 5. Check the saved file really has sound, and tell the person clearly.
      if (rendered) {
        setPrep("Inakagua sauti ya faili…");
        const check = await checkFileSound(blob);
        setPrep("");
        if (check === "silent") notes.push("Onyo: faili limetoka bila sauti. Jaribu Chrome au Edge ya kompyuta.");
        else if (check === "ok")
          notes.unshift(`Sauti imethibitishwa kwenye faili${hasNarr ? " (simulizi" + (beat ? " + beat" : "") + ")" : " (beat tu)"}.`);
        if (codec === "opus")
          notes.push("Sauti ya faili ni Opus (kivinjari hiki hakiwezi AAC). Inacheza Chrome, Edge, Firefox na VLC; kama simu yako haichezi, ifungue kwa VLC.");
      }
    } catch (e) {
      const m = (e as Error).message;
      busyRef.current = false;
      setExportPct(null);
      setPrep("");
      if (m === "AAC_UNSUPPORTED") {
        setMsg("Kivinjari hiki hakiwezi kuweka sauti kwenye MP4. Inarekodi kwa njia ya kawaida (WebM).");
        await start(true);
      } else {
        setMsg(`Imeshindwa kutengeneza MP4: ${m}`);
      }
      return;
    }
    if (notes.length) setMsg(notes.join(" "));
    setExportPct(null);
    busyRef.current = false;
  }

  // ---------- Live playback (and WebM fallback recording) ----------
  async function start(record: boolean) {
    const canvas = canvasRef.current;
    if (!canvas || !clips.length || busyRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (record && typeof MediaRecorder === "undefined") {
      setMsg("Kivinjari hiki hakiwezi kurekodi. Tumia Chrome au Edge kwenye kompyuta.");
      return;
    }
    busyRef.current = true;
    stop();
    setMsg((m) => (record ? m : ""));
    setShareMsg("");

    // 1. Audio context (needed for AI voice and for the beat) + narration (AI voice).
    let actx: AudioContext | null = null;
    let audio: Map<number, Narration> | null = null;
    if (voiceMode === "ai" || beat) {
      try {
        actx = newAudioContext();
        await actx.resume();
      } catch {
        actx = null;
      }
    }
    if (voiceMode === "ai" && actx) {
      const r = await narrateScenes(actx, clips, aiVoice, (n, t) => setPrep(`Inaandaa sauti ya AI… ${n}/${t}`));
      audio = r.audio;
      setPrep("");
      if (r.failed > 0) {
        setMsg(
          audio.size === 0
            ? `${r.lastError} Inatumika sauti ya kifaa badala yake (haiingii kwenye faili la video).`
            : `Simulizi ya maeneo ${r.failed} haikupatikana (${r.lastError}). Jaribu tena baada ya muda mfupi.`
        );
      }
    }
    const hasAiAudio = !!actx && !!audio && audio.size > 0;
    const plan = buildPlan(clips, hasAiAudio ? audio : null);

    // 2. Recorder (fallback only).
    let completed = false;
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    const dest = actx ? actx.createMediaStreamDestination() : null;
    if (record) {
      const tracks = [...canvas.captureStream(30).getVideoTracks(), ...(dest ? dest.stream.getAudioTracks() : [])];
      const candidates = dest
        ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"]
        : ["video/webm;codecs=vp9", "video/webm", "video/mp4;codecs=avc1", "video/mp4"];
      const mime = candidates.find((t) => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mime,
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 160_000,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () => {
        if (!completed) return;
        const type = recorder?.mimeType || "video/webm";
        saveBlob(new Blob(chunks, { type }), `${fileBase()}.${type.includes("mp4") ? "mp4" : "webm"}`);
      };
      if (!dest) setMsg((m) => m || "Rekodi hii haitakuwa na sauti (washa beat au chagua Sauti ya AI).");
    }

    // 3. Schedule narration and beat against the audio clock, through one clean master output.
    //    The beat plays even when there is no AI narration (then it stays at the lower, "under the voice" level
    //    if a device voice speaks, or at full level when nothing speaks).
    const sources: AudioBufferSourceNode[] = [];
    let master: GainNode | null = null;
    if (actx && (hasAiAudio || beat)) {
      master = makeMaster(actx, dest);
      const a0 = actx.currentTime + 0.15;
      if (audio && hasAiAudio) {
        audio.forEach((narr, scene) => {
          const at = plan.sceneStarts.get(scene);
          if (at === undefined) return;
          sources.push(playFaded(actx!, master!, narr, a0 + at + LEAD));
        });
      }
      const deviceTalks = !hasAiAudio && !record && !!window.speechSynthesis;
      const intervals = hasAiAudio && audio ? speechIntervals(plan, audio) : deviceTalks ? [{ start: 0, end: plan.total }] : [];
      if (beat) scheduleBeat(actx, master, a0, plan.total, intervals);
      fadeOutMaster(master, a0 + plan.total - END_FADE, END_FADE * 0.8);
    }

    // 4. Device voice (only when AI voice is not used).
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const useDevice = !hasAiAudio && !record && !!synth;
    const voice = useDevice
      ? pickVoice(voicesRef.current.length ? voicesRef.current : synth!.getVoices(), language, deviceVoice)
      : null;
    if (useDevice && language === "sw" && !voice) {
      setMsg("Kifaa chako hakina sauti ya Kiswahili. Chagua 'Sauti ya AI' ili kupata sauti ya kike au ya kiume.");
    }
    const speak = (text: string) => {
      if (!useDevice || !text || (language === "sw" && !voice)) return;
      synth!.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "en-US";
      }
      synth!.speak(u);
    };

    // 5. Animation loop.
    const state = { idx: -1 };
    let raf = 0;
    let finished = false;
    let lastIdx = -1;
    const t0 = performance.now() + 150;

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      mediaRef.current.forEach((m) => {
        if (m instanceof HTMLVideoElement) m.pause();
      });
      // Soft stop: ramp everything to silence first, then stop the sources and close the context.
      const ac = actx;
      const m = master;
      if (ac && m) {
        try {
          const now = ac.currentTime;
          m.gain.cancelScheduledValues(now);
          m.gain.setValueAtTime(m.gain.value, now);
          m.gain.linearRampToValueAtTime(0, now + 0.15);
        } catch {
          /* context already closed */
        }
      }
      setTimeout(() => {
        sources.forEach((src) => {
          try {
            src.stop();
          } catch {
            /* already stopped */
          }
        });
      }, ac ? 220 : 0);
      synth?.cancel();
      const r = recorder;
      if (r && r.state !== "inactive") setTimeout(() => r.stop(), 500);
      if (ac) setTimeout(() => ac.close().catch(() => {}), 900);
      setPlaying(false);
      setRecording(false);
      cancelRef.current = null;
      busyRef.current = false;
    };

    const tick = () => {
      const t = Math.max(0, (performance.now() - t0) / 1000);
      if (t >= plan.total) {
        drawFrame(ctx, plan.clips, plan.starts, mediaRef.current, plan.total, plan.total, state);
        completed = true;
        finish();
        return;
      }
      const i = drawFrame(ctx, plan.clips, plan.starts, mediaRef.current, t, plan.total, state);
      if (i !== lastIdx) {
        lastIdx = i;
        speak(plan.clips[i].speak);
      }
      raf = requestAnimationFrame(tick);
    };

    cancelRef.current = finish;
    setPlaying(true);
    setRecording(record);
    if (recorder) recorder.start(250);
    raf = requestAnimationFrame(tick);
  }

  const working = prep !== "" || exportPct !== null;

  return (
    <section className="doc">
      <h2>Documentary yako</h2>
      <canvas ref={canvasRef} width={W} height={H} />

      <div className="controls">
        {!playing ? (
          <>
            <button onClick={() => start(false)} disabled={working}>▶ Cheza (~{Math.round(base.total)}s)</button>
            <button className="ghost" onClick={exportMp4} disabled={working}>⬇ Pakua MP4</button>
          </>
        ) : (
          <button onClick={stop}>■ Simama</button>
        )}
      </div>

      <div className="voice-box">
        <label htmlFor="vmode">Sauti ya simulizi</label>
        <select id="vmode" value={voiceMode} onChange={(e) => setVoiceMode(e.target.value as "ai" | "device")} disabled={playing || working}>
          <option value="ai">Sauti ya AI (kike au kiume, inaingia kwenye video)</option>
          <option value="device">Sauti ya kifaa (haiingii kwenye video)</option>
        </select>

        {voiceMode === "ai" ? (
          <select aria-label="Chagua sauti ya AI" value={aiVoice} onChange={(e) => setAiVoice(e.target.value)} disabled={playing || working}>
            <optgroup label="Kike">
              {AI_VOICES.filter((v) => v.gender === "f").map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </optgroup>
            <optgroup label="Kiume">
              {AI_VOICES.filter((v) => v.gender === "m").map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </optgroup>
          </select>
        ) : (
          <select aria-label="Chagua sauti ya kifaa" value={deviceVoice} onChange={(e) => setDeviceVoice(e.target.value)} disabled={playing || working}>
            <option value="">Chagua yenyewe</option>
            {deviceVoices.map((v) => (
              <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
            ))}
          </select>
        )}

        <label className="check">
          <input type="checkbox" checked={beat} onChange={(e) => setBeat(e.target.checked)} disabled={playing || working} />
          <span>Beat ya nyuma (instrumental): inacheza kuanzia mwanzo hadi mwisho wa video, na inapungua msimulizi anapoongea</span>
        </label>
      </div>

      {prep && <p className="muted">{prep}</p>}
      {exportPct !== null && (
        <p className="muted">Inatengeneza MP4… {exportPct}%. Acha ukurasa huu wazi hadi imalize.</p>
      )}
      {recording && (
        <p className="muted">Inarekodi… acha ukurasa huu wazi na usibadilishe tab hadi imalize.</p>
      )}
      {msg && <p className="msg">{msg}</p>}

      {lastBlob && !playing && (
        <div className="share">
          <p className="info">Video yako imetengenezwa na kupakuliwa.</p>
          <button onClick={share} disabled={uploading}>
            {uploading ? `Inapakia… ${progress}%` : "☁ Pata link ya kushiriki"}
          </button>
        </div>
      )}

      {shareUrl && (
        <div className="share">
          <label htmlFor="share-link">Link ya video yako</label>
          <div className="row">
            <input id="share-link" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
            <button className="ghost" onClick={copyLink}>{copied ? "Imenakiliwa" : "Nakili"}</button>
            <a href={shareUrl} target="_blank" rel="noreferrer">Fungua</a>
          </div>
        </div>
      )}
      {shareMsg && <p className="msg">{shareMsg}</p>}

      <p className="muted">
        Faili la MP4 linatengenezwa fremu kwa fremu pamoja na sauti, kwa hiyo linatoka safi bila kelele mwishoni.
        Picha zinaonyeshwa nzima ili watu wasikatwe. Kasi ya onyesho hurekebishwa yenyewe ili simulizi iishe kabla
        picha haijabadilika.
      </p>
    </section>
  );
}
