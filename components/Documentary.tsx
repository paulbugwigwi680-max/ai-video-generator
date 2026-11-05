"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type Clip = {
  kind: "video" | "image";
  src: string;
  duration: number;
  caption: string; // text shown on screen for this clip
  speak: string; // full scene narration, read aloud at the first clip of each scene
};

type Media = HTMLImageElement | HTMLVideoElement;

const W = 1280;
const H = 720;

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

// Picks the best device voice for the project language (Swahili or English).
function pickVoice(voices: SpeechSynthesisVoice[], language: string): SpeechSynthesisVoice | null {
  const norm = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  const natural = (v: SpeechSynthesisVoice) => /natural|online/i.test(v.name);

  if (language === "sw") {
    const byLang = voices.filter((v) => norm(v).startsWith("sw"));
    const pool = byLang.length ? byLang : voices.filter((v) => /swahili|kiswahili/i.test(v.name));
    return (
      pool.find((v) => natural(v) && norm(v) === "sw-tz") ??
      pool.find(natural) ??
      pool.find((v) => norm(v) === "sw-tz") ??
      pool[0] ??
      null
    );
  }
  const pool = voices.filter((v) => norm(v).startsWith("en"));
  return pool.find(natural) ?? pool[0] ?? null;
}

// Uploads the recorded video straight from the browser to Cloudinary (unsigned preset).
function uploadToCloudinary(blob: Blob, filename: string, onProgress: (pct: number) => void): Promise<string> {
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  return new Promise((resolve, reject) => {
    if (!cloud || !preset) {
      reject(new Error("Cloudinary haijawekwa."));
      return;
    }
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("upload_preset", preset);
    form.append("tags", "bugwigwi");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloud}/video/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && json.secure_url) resolve(json.secure_url as string);
        else reject(new Error(json?.error?.message ?? `Upload imeshindwa (${xhr.status})`));
      } catch {
        reject(new Error("Jibu lisilotarajiwa kutoka Cloudinary."));
      }
    };
    xhr.onerror = () => reject(new Error("Hitilafu ya mtandao."));
    xhr.send(form);
  });
}

// Draws one frame of the documentary at time t (seconds). Returns the index of the active clip.
function drawFrame(
  ctx: CanvasRenderingContext2D,
  clips: Clip[],
  starts: number[],
  media: Media[],
  t: number,
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
      ctx.globalAlpha = Math.min(1, local / 0.08); // fade in
      ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
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
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [msg, setMsg] = useState("");
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [voicesChecked, setVoicesChecked] = useState(false);

  // Sharing (Cloudinary)
  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const [lastName, setLastName] = useState("documentary.webm");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [shareUrl, setShareUrl] = useState<string | null>(finalUrl);
  const [shareMsg, setShareMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const starts = useMemo(() => {
    let acc = 0;
    return clips.map((c) => {
      const s = acc;
      acc += c.duration;
      return s;
    });
  }, [clips]);
  const total = useMemo(() => clips.reduce((a, c) => a + c.duration, 0), [clips]);

  // Load device voices. Browsers often fill this list late, so we also listen for changes.
  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) {
      setVoicesChecked(true);
      return;
    }
    const load = () => {
      voicesRef.current = synth.getVoices();
      setVoiceName(pickVoice(voicesRef.current, language)?.name ?? null);
      setVoicesChecked(true);
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
      if (ctx) drawFrame(ctx, clips, starts, mediaRef.current, 0, { idx: -1 });
    };
    const first = mediaRef.current[0];
    if (first instanceof HTMLImageElement) first.onload = paint;
    else if (first) first.onloadeddata = paint;

    return () => {
      cancelRef.current?.();
    };
  }, [clips, starts]);

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

  function start(record: boolean) {
    const canvas = canvasRef.current;
    if (!canvas || !clips.length) return;
    stop();
    setMsg("");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let completed = false;
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];

    if (record) {
      if (typeof MediaRecorder === "undefined") {
        setMsg("Kivinjari hiki hakiwezi kurekodi. Tumia Chrome au Edge kwenye kompyuta.");
        return;
      }
      const mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) =>
        MediaRecorder.isTypeSupported(t)
      );
      recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 5_000_000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () => {
        if (!completed) return;
        const type = recorder?.mimeType || "video/webm";
        const blob = new Blob(chunks, { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const base = title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 50) || "documentary";
        const filename = `${base}.${type.includes("mp4") ? "mp4" : "webm"}`;
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setLastBlob(blob);
        setLastName(filename);
        setShareMsg("");
      };
    }

    // Narration with the device voice (not captured in the recording).
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const wantSpeech = !record && !!synth;
    const voice = wantSpeech ? pickVoice(voicesRef.current.length ? voicesRef.current : synth!.getVoices(), language) : null;
    if (wantSpeech && language === "sw" && !voice) {
      setMsg("Kifaa chako hakina sauti ya Kiswahili, kwa hiyo simulizi inaonyeshwa kama maandishi tu.");
    }
    const speak = (text: string) => {
      if (!wantSpeech || !text || (language === "sw" && !voice)) return;
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

    const state = { idx: -1 };
    let raf = 0;
    let finished = false;
    let lastIdx = -1;
    const t0 = performance.now();

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      mediaRef.current.forEach((m) => {
        if (m instanceof HTMLVideoElement) m.pause();
      });
      synth?.cancel();
      const r = recorder;
      if (r && r.state !== "inactive") setTimeout(() => r.stop(), 300);
      setPlaying(false);
      setRecording(false);
      cancelRef.current = null;
    };

    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) {
        drawFrame(ctx, clips, starts, mediaRef.current, total - 0.001, state);
        completed = true;
        finish();
        return;
      }
      const i = drawFrame(ctx, clips, starts, mediaRef.current, t, state);
      if (i !== lastIdx) {
        lastIdx = i;
        speak(clips[i].speak);
      }
      raf = requestAnimationFrame(tick);
    };

    cancelRef.current = finish;
    setPlaying(true);
    setRecording(record);
    if (recorder) recorder.start(250);
    raf = requestAnimationFrame(tick);
  }

  return (
    <section className="doc">
      <h2>Documentary yako</h2>
      <canvas ref={canvasRef} width={W} height={H} />
      <div className="controls">
        {!playing ? (
          <>
            <button onClick={() => start(false)}>▶ Cheza ({Math.round(total)}s)</button>
            <button className="ghost" onClick={() => start(true)}>⬇ Rekodi na pakua video</button>
          </>
        ) : (
          <button onClick={stop}>■ Simama</button>
        )}
      </div>

      {recording && (
        <p className="muted">Inarekodi… acha ukurasa huu wazi na usibadilishe tab hadi imalize ({Math.round(total)}s).</p>
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

      {voicesChecked && (
        <p className="muted">
          {voiceName
            ? `Sauti ya simulizi: ${voiceName}`
            : language === "sw"
              ? "Hakuna sauti ya Kiswahili kwenye kifaa hiki. Jaribu Microsoft Edge kwenye kompyuta, au angalia mipangilio ya Text-to-speech ya simu yako."
              : "Hakuna sauti ya Kiingereza iliyopatikana kwenye kifaa hiki."}
        </p>
      )}

      <p className="muted">
        Picha zinasogea polepole kama documentary ya picha; video za AI zikiwepo zinachezwa kama zilivyo. Sauti ya
        msimulizi inasikika wakati wa kucheza tu (kwa kutumia sauti ya kifaa chako). Faili la kupakua halina sauti.
      </p>
    </section>
  );
}
