"use client";

import { useEffect, useRef, useState } from "react";
import { pickVoice } from "@/lib/voices";
import { uploadToCloudinary } from "@/lib/cloudinary-client";

type Mode = "talk" | "song";
type Ratio = "wide" | "tall";

const SIZES: Record<Ratio, { w: number; h: number }> = {
  wide: { w: 1280, h: 720 },
  tall: { w: 720, h: 1280 },
};

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

// Talk mode: one segment per sentence. Song mode: one segment per line.
function toSegments(text: string, mode: Mode) {
  const t = text.trim();
  const parts = mode === "song" ? t.split(/\n+/) : t.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

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

function drawScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  img: HTMLImageElement | null,
  text: string,
  progress: number,
  speaking: boolean,
  mode: Mode,
  t: number
) {
  ctx.fillStyle = "#0b1218";
  ctx.fillRect(0, 0, W, H);

  if (img && img.complete && img.naturalWidth) {
    // Gentle breathing zoom, with a small bob while "speaking".
    const breathe = 1.05 + 0.012 * Math.sin(t * 1.3);
    const talk = speaking ? 0.008 * Math.abs(Math.sin(t * 7.5)) : 0;
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight) * (breathe + talk);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const bob = speaking ? 4 * Math.sin(t * 7.5) : 0;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2 + bob, dw, dh);
  }

  if (mode === "song") {
    ctx.fillStyle = `rgba(14,124,134,${0.07 + 0.07 * Math.abs(Math.sin(t * 4))})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Caption area
  const gh = Math.round(H * 0.38);
  const grad = ctx.createLinearGradient(0, H - gh, 0, H);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.8)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, H - gh, W, gh);

  const fontSize = W > H ? 36 : 40;
  ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const lines = wrapText(ctx, text, W - 120).slice(0, 4);
  const total = lines.join(" ").length || 1;
  let remaining = Math.floor(progress * total);
  const lineH = Math.round(fontSize * 1.35);
  lines.forEach((line, k) => {
    const y = H - 56 - (lines.length - 1 - k) * lineH;
    const hl = Math.max(0, Math.min(line.length, remaining));
    const a = line.slice(0, hl);
    const b = line.slice(hl);
    ctx.fillStyle = "#c9a45a"; // already spoken
    ctx.fillText(a, 60, y);
    const wA = ctx.measureText(a).width;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(b, 60 + wA, y);
    remaining -= line.length + 1;
  });

  // Mark: this video is AI-generated
  ctx.font = "700 18px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.textAlign = "right";
  ctx.fillText("AI · BUGWIGWI", W - 28, 40);
  ctx.textAlign = "left";
}

export default function TalkPhoto() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const [hasPhoto, setHasPhoto] = useState(false);
  const [consent, setConsent] = useState(false);
  const [script, setScript] = useState("");
  const [mode, setMode] = useState<Mode>("talk");
  const [lang, setLang] = useState<"sw" | "en">("sw");
  const [ratio, setRatio] = useState<Ratio>("wide");
  const [rate, setRate] = useState(0.95);
  const [pitch, setPitch] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [msg, setMsg] = useState("");
  const [voiceName, setVoiceName] = useState<string | null>(null);

  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const [lastName, setLastName] = useState("picha-inayoongea.webm");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const size = SIZES[ratio];
  const canRun = consent && hasPhoto && script.trim().length > 0;

  // Device voices (the list often fills late, so we listen for changes).
  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    const load = () => setVoiceName(pickVoice(synth.getVoices(), lang)?.name ?? null);
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, [lang]);

  // Idle preview frame.
  useEffect(() => {
    if (playing) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const first = toSegments(script, mode)[0] ?? "";
    drawScene(ctx, size.w, size.h, imgRef.current, first, 0, false, mode, 0);
  }, [hasPhoto, ratio, script, mode, playing, size.w, size.h]);

  useEffect(() => () => cancelRef.current?.(), []);

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMsg("Chagua faili la picha.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMsg("Picha ni kubwa mno (kikomo ni MB 10).");
      return;
    }
    setMsg("");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setHasPhoto(true);
    };
    img.src = url;
  }

  function stop() {
    cancelRef.current?.();
  }

  function start(record: boolean) {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !canRun) return;
    const segments = toSegments(script, mode);
    if (!segments.length) {
      setMsg("Andika maneno kwanza.");
      return;
    }
    stop();
    setMsg("");
    setShareUrl(null);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const voice = synth ? pickVoice(synth.getVoices(), lang) : null;
    const canSpeak = !!synth && (lang !== "sw" || !!voice);
    if (!canSpeak) setMsg("Kifaa chako hakina sauti ya Kiswahili; maneno yataonekana bila sauti. Jaribu Microsoft Edge.");

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
        const filename = `picha-inayoongea.${type.includes("mp4") ? "mp4" : "webm"}`;
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setLastBlob(blob);
        setLastName(filename);
      };
    }

    const run = { seg: 0, segStart: performance.now(), segDur: 1, speaking: false };
    const t0 = performance.now();
    const timers: number[] = [];
    let raf = 0;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
      synth?.cancel();
      const r = recorder;
      if (r && r.state !== "inactive") window.setTimeout(() => r.stop(), 300);
      setPlaying(false);
      setRecording(false);
      cancelRef.current = null;
    };

    const advance = (i: number) => {
      if (finished) return;
      if (i >= segments.length) {
        run.speaking = false;
        timers.push(
          window.setTimeout(() => {
            completed = true;
            finish();
          }, 700)
        );
        return;
      }
      run.seg = i;
      run.segStart = performance.now();
      run.speaking = true;
      const text = segments[i];
      const estimate = Math.max(1.5, countWords(text) / (2.3 * rate) + 0.3);
      run.segDur = estimate;

      let moved = false;
      const next = () => {
        if (moved || finished) return;
        moved = true;
        advance(i + 1);
      };

      if (canSpeak && synth) {
        const u = new SpeechSynthesisUtterance(text);
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        } else {
          u.lang = "en-US";
        }
        u.rate = rate;
        u.pitch = mode === "song" ? Math.min(2, Math.max(0.1, pitch + (i % 2 ? 0.2 : -0.1))) : pitch;
        u.onend = next;
        u.onerror = next;
        timers.push(window.setTimeout(next, (estimate * 2 + 4) * 1000)); // safety net
        synth.cancel();
        synth.speak(u);
      } else {
        timers.push(window.setTimeout(next, estimate * 1000));
      }
    };

    const tick = () => {
      const now = performance.now();
      const p = Math.min(1, (now - run.segStart) / 1000 / run.segDur);
      drawScene(ctx, size.w, size.h, img, segments[Math.min(run.seg, segments.length - 1)], p, run.speaking, mode, (now - t0) / 1000);
      raf = requestAnimationFrame(tick);
    };

    cancelRef.current = finish;
    setPlaying(true);
    setRecording(record);
    if (recorder) recorder.start(250);
    advance(0);
    raf = requestAnimationFrame(tick);
  }

  async function share() {
    if (!lastBlob || uploading) return;
    setUploading(true);
    setProgress(0);
    setMsg("");
    try {
      setShareUrl(await uploadToCloudinary(lastBlob, lastName, setProgress));
      setLastBlob(null);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setUploading(false);
  }

  return (
    <div className="talk">
      <div className="panel">
        <label htmlFor="photo">1. Picha</label>
        <input id="photo" type="file" accept="image/*" onChange={onPhoto} />

        <label htmlFor="mode">2. Aina</label>
        <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="talk">Zungumza (script)</option>
          <option value="song">Wimbo wa maneno (kila mstari ni mstari wa wimbo)</option>
        </select>

        <label htmlFor="script">{mode === "song" ? "3. Maneno ya wimbo" : "3. Script (picha iseme nini)"}</label>
        <textarea
          id="script"
          rows={8}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={mode === "song" ? "Mstari wa kwanza\nMstari wa pili" : "Habari! Karibu kwenye kijiji chetu cha pwani."}
        />

        <label htmlFor="lang">Lugha ya sauti</label>
        <select id="lang" value={lang} onChange={(e) => setLang(e.target.value as "sw" | "en")}>
          <option value="sw">Kiswahili</option>
          <option value="en">English</option>
        </select>

        <label htmlFor="ratio">Muundo</label>
        <select id="ratio" value={ratio} onChange={(e) => setRatio(e.target.value as Ratio)}>
          <option value="wide">Mlalo (YouTube)</option>
          <option value="tall">Wima (WhatsApp Status, TikTok)</option>
        </select>

        <label htmlFor="rate">Kasi ya sauti: {rate.toFixed(2)}</label>
        <input id="rate" type="range" min={0.6} max={1.3} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} />

        <label htmlFor="pitch">Mwinuko wa sauti: {pitch.toFixed(2)}</label>
        <input id="pitch" type="range" min={0.5} max={1.5} step={0.05} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} />

        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            Nathibitisha kwamba nina ruhusa ya kutumia picha hii, na sijifanyi mtu mwingine wala mtu maarufu.
          </span>
        </label>
      </div>

      <div>
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          style={{ width: "100%", maxWidth: ratio === "tall" ? 360 : 760 }}
        />
        <div className="controls" style={{ marginTop: 12 }}>
          {!playing ? (
            <>
              <button onClick={() => start(false)} disabled={!canRun}>▶ Cheza</button>
              <button className="ghost" onClick={() => start(true)} disabled={!canRun}>⬇ Rekodi na pakua</button>
            </>
          ) : (
            <button onClick={stop}>■ Simama</button>
          )}
        </div>

        {recording && <p className="muted">Inarekodi… acha ukurasa wazi hadi imalize.</p>}
        {msg && <p className="msg">{msg}</p>}
        {!consent && hasPhoto && <p className="muted">Thibitisha ruhusa ya picha ili kuendelea.</p>}

        {lastBlob && !playing && (
          <p style={{ marginTop: 12 }}>
            <button onClick={share} disabled={uploading}>
              {uploading ? `Inapakia… ${progress}%` : "☁ Pata link ya kushiriki"}
            </button>
          </p>
        )}
        {shareUrl && (
          <div className="share">
            <label htmlFor="talk-link">Link ya video</label>
            <input id="talk-link" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}

        <p className="muted" style={{ marginTop: 14 }}>
          {voiceName ? `Sauti: ${voiceName}. ` : lang === "sw" ? "Hakuna sauti ya Kiswahili kwenye kifaa hiki (jaribu Microsoft Edge). " : ""}
          Picha inabaki kwenye kifaa chako. Faili la kupakua halina sauti (sauti inasikika wakati wa kucheza tu).
        </p>
      </div>
    </div>
  );
}
