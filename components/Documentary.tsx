"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { pickVoice, voicesFor } from "@/lib/voices";
import { AI_VOICES, DEFAULT_AI_VOICE } from "@/lib/tts-voices";
import { fetchNarration, newAudioContext } from "@/lib/narration-client";
import { uploadToCloudinary } from "@/lib/cloudinary-client";
import { analyzeNarration, fadeOutMaster, makeMaster, playFaded, type Narration } from "@/lib/audio-utils";

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

  if (el) {
    const isVideo = el instanceof HTMLVideoElement;
    const ready = isVideo ? el.readyState >= 2 : el.complete && el.naturalWidth > 0;
    if (ready) {
      const sw = isVideo ? el.videoWidth : el.naturalWidth;
      const sh = isVideo ? el.videoHeight : el.naturalHeight;
      // Slow zoom ("Ken Burns") on still pictures, alternating direction.
      const zoom = isVideo ? 1 : i % 2 ? 1.14 - 0.14 * local : 1 + 0.14 * local;
      const scale = Math.max(W / sw, H / sh) * zoom;
      const dw = sw * scale;
      const dh = sh * scale;
      ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
  }

  // Caption
  const grad = ctx.createLinearGradient(0, H - 230, 0, H);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.78)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, H - 230, W, 230);
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

  // Fade in from black at the start and out to black at the end (clean beginning and ending).
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
  const [prep, setPrep] = useState("");
  const [msg, setMsg] = useState("");

  // Narration voice
  const [voiceMode, setVoiceMode] = useState<"ai" | "device">("ai");
  const [aiVoice, setAiVoice] = useState(DEFAULT_AI_VOICE);
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [deviceVoice, setDeviceVoice] = useState("");

  // Sharing (Cloudinary)
  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const [lastName, setLastName] = useState("documentary.webm");
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
    setMsg("");
    setShareMsg("");

    // 1. Narration audio (AI voice) so it can be heard AND recorded into the file.
    let actx: AudioContext | null = null;
    let audio: Map<number, Narration> | null = null;
    if (voiceMode === "ai") {
      try {
        actx = newAudioContext();
        await actx.resume();
        audio = new Map();
        const scenes = Array.from(new Set(clips.map((c) => c.scene)));
        let n = 0;
        for (const sc of scenes) {
          const text = clips.find((c) => c.scene === sc && c.speak)?.speak;
          n++;
          if (!text) continue;
          setPrep(`Inaandaa sauti ya AI… ${n}/${scenes.length}`);
          audio.set(sc, analyzeNarration(await fetchNarration(actx, text, aiVoice)));
        }
      } catch (e) {
        setMsg(`${(e as Error).message} Inatumika sauti ya kifaa badala yake (haiingii kwenye faili la video).`);
        actx?.close().catch(() => {});
        actx = null;
        audio = null;
      }
      setPrep("");
    }
    const hasAiAudio = !!actx && !!audio && audio.size > 0;
    const plan = buildPlan(clips, hasAiAudio ? audio : null);

    // 2. Recorder (video + narration mixed together). WebM/Opus first: it is the cleanest.
    let completed = false;
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    const dest = hasAiAudio && actx ? actx.createMediaStreamDestination() : null;

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
        const blob = new Blob(chunks, { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const baseName = title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 50) || "documentary";
        const filename = `${baseName}.${type.includes("mp4") ? "mp4" : "webm"}`;
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setLastBlob(blob);
        setLastName(filename);
      };
      if (!dest) setMsg((m) => m || "Rekodi hii haitakuwa na sauti (sauti ya AI haikupatikana).");
    }

    // 3. Schedule the narration against the audio clock, through one clean master output.
    const sources: AudioBufferSourceNode[] = [];
    if (actx && audio && hasAiAudio) {
      const master = makeMaster(actx, dest);
      const a0 = actx.currentTime + 0.15;
      audio.forEach((narr, scene) => {
        const at = plan.sceneStarts.get(scene);
        if (at === undefined) return;
        sources.push(playFaded(actx!, master, narr, a0 + at + LEAD));
      });
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
      sources.forEach((s) => {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      });
      synth?.cancel();
      const r = recorder;
      if (r && r.state !== "inactive") setTimeout(() => r.stop(), 400);
      const ac = actx;
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

  const preparing = prep !== "";

  return (
    <section className="doc">
      <h2>Documentary yako</h2>
      <canvas ref={canvasRef} width={W} height={H} />

      <div className="controls">
        {!playing ? (
          <>
            <button onClick={() => start(false)} disabled={preparing}>▶ Cheza (~{Math.round(base.total)}s)</button>
            <button className="ghost" onClick={() => start(true)} disabled={preparing}>⬇ Rekodi na pakua video</button>
          </>
        ) : (
          <button onClick={stop}>■ Simama</button>
        )}
      </div>

      <div className="voice-box">
        <label htmlFor="vmode">Sauti ya simulizi</label>
        <select id="vmode" value={voiceMode} onChange={(e) => setVoiceMode(e.target.value as "ai" | "device")} disabled={playing}>
          <option value="ai">Sauti ya AI (kike au kiume, inaingia kwenye video)</option>
          <option value="device">Sauti ya kifaa (haiingii kwenye video)</option>
        </select>

        {voiceMode === "ai" ? (
          <select aria-label="Chagua sauti ya AI" value={aiVoice} onChange={(e) => setAiVoice(e.target.value)} disabled={playing}>
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
          <select aria-label="Chagua sauti ya kifaa" value={deviceVoice} onChange={(e) => setDeviceVoice(e.target.value)} disabled={playing}>
            <option value="">Chagua yenyewe</option>
            {deviceVoices.map((v) => (
              <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
            ))}
          </select>
        )}
      </div>

      {preparing && <p className="muted">{prep}</p>}
      {recording && (
        <p className="muted">Inarekodi… acha ukurasa huu wazi na usibadilishe tab hadi imalize.</p>
      )}
      {msg && <p className="msg">{msg}</p>}

      {lastBlob && !playing && (
        <div className="share">
          <p className="info">Video yako imerekodiwa na kupakuliwa.</p>
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
        Sauti ya AI inatengenezwa na Gemini, inasomwa kwa Kiswahili na inarekodiwa pamoja na picha, kwa hiyo faili
        unalopakua lina sauti. Kasi ya picha hurekebishwa yenyewe ili simulizi iishe kabla ya onyesho kubadilika.
      </p>
    </section>
  );
}
