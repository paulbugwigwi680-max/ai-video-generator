"use client";

import { useEffect, useRef, useState } from "react";
import { pickVoice, voicesFor } from "@/lib/voices";
import { AI_VOICES, DEFAULT_AI_VOICE } from "@/lib/tts-voices";
import { fetchNarration, newAudioContext } from "@/lib/narration-client";
import { uploadToCloudinary } from "@/lib/cloudinary-client";
import { analyzeNarration, fadeOutMaster, makeMaster, playFaded } from "@/lib/audio-utils";

type Mode = "talk" | "song";
type Ratio = "wide" | "tall";
type Mouth = { x: number; y: number }; // position on the photo, 0..1

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

function imageRect(img: HTMLImageElement, W: number, H: number, zoom: number) {
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom;
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  return { dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh };
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  img: HTMLImageElement | null,
  text: string,
  progress: number,
  amp: number, // 0..1 loudness of the voice right now
  mouth: Mouth | null,
  mode: Mode,
  t: number,
  showMarker: boolean,
  fade: number // 0..1 black overlay (clean start and end)
) {
  ctx.fillStyle = "#0b1218";
  ctx.fillRect(0, 0, W, H);

  if (img && img.complete && img.naturalWidth) {
    // Gentle breathing zoom, plus a small bob that follows the loudness of the voice.
    const zoom = 1.05 + 0.012 * Math.sin(t * 1.3) + 0.006 * amp;
    const { dx, dy: dy0, dw, dh } = imageRect(img, W, H, zoom);
    const dy = dy0 + 3 * amp * Math.sin(t * 7.5);
    ctx.drawImage(img, dx, dy, dw, dh);

    // Mouth movement: the lower face is lowered a little with the voice (amplitude driven).
    if (mouth && amp > 0.04) {
      const cx = dx + mouth.x * dw;
      const cy = dy + mouth.y * dh;
      const shift = Math.min(amp, 1) * dh * 0.02;
      const jawW = dw * 0.13;
      const jawH = dh * 0.16;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy + jawH * 0.55, jawW, jawH, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#1d0a0c"; // inside of the mouth
      ctx.beginPath();
      ctx.ellipse(cx, cy + shift * 0.5, dw * 0.045, Math.max(1, shift * 0.6), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(0, cy + shift, W, H);
      ctx.clip();
      ctx.drawImage(img, dx, dy + shift, dw, dh);
      ctx.restore();
    }

    if (mouth && showMarker) {
      ctx.strokeStyle = "rgba(201,164,90,0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(dx + mouth.x * dw, dy + mouth.y * dh, 16, 0, Math.PI * 2);
      ctx.stroke();
    }
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

  if (fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, fade)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

export default function TalkPhoto() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  const [hasPhoto, setHasPhoto] = useState(false);
  const [consent, setConsent] = useState(false);
  const [script, setScript] = useState("");
  const [mode, setMode] = useState<Mode>("talk");
  const [lang, setLang] = useState<"sw" | "en">("sw");
  const [ratio, setRatio] = useState<Ratio>("wide");
  const [mouth, setMouth] = useState<Mouth | null>(null);

  const [voiceMode, setVoiceMode] = useState<"ai" | "device">("ai");
  const [aiVoice, setAiVoice] = useState(DEFAULT_AI_VOICE);
  const [style, setStyle] = useState("");
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [deviceVoice, setDeviceVoice] = useState("");
  const [rate, setRate] = useState(0.95);
  const [pitch, setPitch] = useState(1);

  const [prep, setPrep] = useState("");
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [msg, setMsg] = useState("");

  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const [lastName, setLastName] = useState("picha-inayoongea.webm");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const size = SIZES[ratio];
  const canRun = consent && hasPhoto && script.trim().length > 0 && prep === "";

  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    const load = () => {
      voicesRef.current = synth.getVoices();
      setDeviceVoices(voicesFor(voicesRef.current, lang));
    };
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
    drawScene(ctx, size.w, size.h, imgRef.current, first, 0, 0, mouth, mode, 0, true, 0);
  }, [hasPhoto, ratio, script, mode, mouth, playing, size.w, size.h]);

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
    setMouth(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setHasPhoto(true);
    };
    img.src = url;
  }

  // Click on the photo to mark where the mouth is.
  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || playing) return;
    const r = canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * size.w;
    const cy = ((e.clientY - r.top) / r.height) * size.h;
    const { dx, dy, dw, dh } = imageRect(img, size.w, size.h, 1.05);
    setMouth({ x: (cx - dx) / dw, y: (cy - dy) / dh });
  }

  function stop() {
    cancelRef.current?.();
  }

  async function start(record: boolean) {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !canRun || busyRef.current) return;
    const segments = toSegments(script, mode);
    if (!segments.length) {
      setMsg("Andika maneno kwanza.");
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (record && typeof MediaRecorder === "undefined") {
      setMsg("Kivinjari hiki hakiwezi kurekodi. Tumia Chrome au Edge kwenye kompyuta.");
      return;
    }
    busyRef.current = true;
    stop();
    setMsg("");
    setShareUrl(null);

    // 1. AI narration of the WHOLE script (so it can be heard and recorded).
    let actx: AudioContext | null = null;
    let narr: ReturnType<typeof analyzeNarration> | null = null;
    if (voiceMode === "ai") {
      try {
        actx = newAudioContext();
        await actx.resume();
        setPrep("Inaandaa sauti ya AI…");
        const styleText = style.trim() || (mode === "song" ? "in a melodic, rhythmic, sing-song way" : "");
        const buf = await fetchNarration(actx, segments.join("\n").slice(0, 1800), aiVoice, styleText);
        narr = analyzeNarration(buf);
      } catch (e) {
        setMsg(`${(e as Error).message} Inatumika sauti ya kifaa badala yake (haiingii kwenye faili la video).`);
        actx?.close().catch(() => {});
        actx = null;
        narr = null;
      }
      setPrep("");
    }
    const ai = !!actx && !!narr;

    // 2. Recorder (video + voice). WebM/Opus first: it is the cleanest.
    let completed = false;
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    const dest = ai && actx ? actx.createMediaStreamDestination() : null;
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
        const filename = `picha-inayoongea.${type.includes("mp4") ? "mp4" : "webm"}`;
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setLastBlob(blob);
        setLastName(filename);
      };
      if (!dest) setMsg((m) => m || "Rekodi hii haitakuwa na sauti (sauti ya AI haikupatikana).");
    }

    // 3. Shared state for the animation loop.
    const timers: number[] = [];
    let raf = 0;
    let finished = false;
    const t0 = performance.now();
    let src: AudioBufferSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    const levels = new Uint8Array(512);
    let amp = 0;

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
      try {
        src?.stop();
      } catch {
        /* already stopped */
      }
      window.speechSynthesis?.cancel();
      const r = recorder;
      if (r && r.state !== "inactive") window.setTimeout(() => r.stop(), 400);
      const ac = actx;
      if (ac) window.setTimeout(() => ac.close().catch(() => {}), 900);
      setPlaying(false);
      setRecording(false);
      cancelRef.current = null;
      busyRef.current = false;
    };

    cancelRef.current = finish;
    setPlaying(true);
    setRecording(record);
    if (recorder) recorder.start(250);

    if (ai && actx && narr) {
      // ---- AI voice: everything follows the audio clock and the real loudness ----
      const D = narr.dur;
      const weights = segments.map((s) => s.length + 1);
      const sum = weights.reduce((a, b) => a + b, 0);
      const bounds: number[] = [];
      let acc = 0;
      for (const w of weights) {
        bounds.push((acc / sum) * D);
        acc += w;
      }
      bounds.push(D);

      const master = makeMaster(actx, dest);
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.connect(master);
      const audioStart = actx.currentTime + 0.4;
      src = playFaded(actx, analyser, narr, audioStart);
      fadeOutMaster(master, audioStart + D + 0.15, 0.55);

      const TAIL = 0.9;
      const tick = () => {
        const now = (performance.now() - t0) / 1000;
        const el = actx!.currentTime - audioStart;
        if (el > D + TAIL) {
          completed = true;
          finish();
          return;
        }
        const e = Math.min(Math.max(el, 0), D - 0.001);
        let seg = 0;
        while (seg < segments.length - 1 && e >= bounds[seg + 1]) seg++;
        const p = Math.min(1, Math.max(0, (e - bounds[seg]) / Math.max(0.1, bounds[seg + 1] - bounds[seg])));

        analyser!.getByteTimeDomainData(levels);
        let s2 = 0;
        for (let i = 0; i < levels.length; i++) {
          const v = (levels[i] - 128) / 128;
          s2 += v * v;
        }
        const rms = Math.sqrt(s2 / levels.length);
        amp = amp * 0.5 + Math.min(1, rms * 5) * 0.5;

        const fadeIn = Math.max(0, 1 - now / 0.4);
        const fadeOut = Math.max(0, (el - (D + 0.15)) / (TAIL - 0.15));
        drawScene(
          ctx, size.w, size.h, img, segments[seg], p,
          el >= 0 && el <= D ? amp : 0, mouth, mode, now, false, Math.max(fadeIn, fadeOut)
        );
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return;
    }

    // ---- Device voice (no recording of the sound) ----
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const voice = synth
      ? pickVoice(voicesRef.current.length ? voicesRef.current : synth.getVoices(), lang, deviceVoice)
      : null;
    const canSpeak = !!synth && (lang !== "sw" || !!voice);
    if (!canSpeak) {
      setMsg("Kifaa chako hakina sauti ya Kiswahili. Chagua 'Sauti ya AI' ili kupata sauti ya kike au ya kiume.");
    }

    const run = { seg: 0, segStart: performance.now(), segDur: 1, speaking: false };

    const advance = (i: number) => {
      if (finished) return;
      if (i >= segments.length) {
        run.speaking = false;
        timers.push(
          window.setTimeout(() => {
            completed = true;
            finish();
          }, 900)
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
      const fakeAmp = run.speaking ? 0.3 + 0.3 * Math.abs(Math.sin(((now - t0) / 1000) * 9)) : 0;
      const fadeIn = Math.max(0, 1 - (now - t0) / 1000 / 0.4);
      drawScene(
        ctx, size.w, size.h, img, segments[Math.min(run.seg, segments.length - 1)], p,
        fakeAmp, mouth, mode, (now - t0) / 1000, false, fadeIn
      );
      raf = requestAnimationFrame(tick);
    };

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
          maxLength={1800}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={mode === "song" ? "Mstari wa kwanza\nMstari wa pili" : "Habari! Karibu kwenye kijiji chetu cha pwani."}
        />

        <label htmlFor="lang">Lugha</label>
        <select id="lang" value={lang} onChange={(e) => setLang(e.target.value as "sw" | "en")}>
          <option value="sw">Kiswahili</option>
          <option value="en">English</option>
        </select>

        <label htmlFor="vmode">Sauti</label>
        <select id="vmode" value={voiceMode} onChange={(e) => setVoiceMode(e.target.value as "ai" | "device")}>
          <option value="ai">Sauti ya AI (kike au kiume, inaingia kwenye video)</option>
          <option value="device">Sauti ya kifaa (haiingii kwenye video)</option>
        </select>

        {voiceMode === "ai" ? (
          <>
            <select aria-label="Chagua sauti ya AI" value={aiVoice} onChange={(e) => setAiVoice(e.target.value)} style={{ marginTop: 8 }}>
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
            <label htmlFor="style">Mtindo wa sauti (hiari, kwa Kiingereza)</label>
            <input
              id="style"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder={mode === "song" ? "in a melodic, rhythmic, sing-song way" : "warmly and slowly"}
            />
          </>
        ) : (
          <>
            <select aria-label="Chagua sauti ya kifaa" value={deviceVoice} onChange={(e) => setDeviceVoice(e.target.value)} style={{ marginTop: 8 }}>
              <option value="">Chagua yenyewe</option>
              {deviceVoices.map((v) => (
                <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
              ))}
            </select>
            <label htmlFor="rate">Kasi: {rate.toFixed(2)}</label>
            <input id="rate" type="range" min={0.6} max={1.3} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
            <label htmlFor="pitch">Mwinuko: {pitch.toFixed(2)}</label>
            <input id="pitch" type="range" min={0.5} max={1.5} step={0.05} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} />
          </>
        )}

        <label htmlFor="ratio">Muundo</label>
        <select id="ratio" value={ratio} onChange={(e) => setRatio(e.target.value as Ratio)}>
          <option value="wide">Mlalo (YouTube)</option>
          <option value="tall">Wima (WhatsApp Status, TikTok)</option>
        </select>

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
          onClick={onCanvasClick}
          style={{ width: "100%", maxWidth: ratio === "tall" ? 360 : 760, cursor: hasPhoto && !playing ? "crosshair" : "default" }}
        />
        {hasPhoto && !playing && (
          <p className="muted" style={{ marginTop: 8 }}>
            {mouth
              ? "Mdomo umewekwa (duara la dhahabu). Bonyeza mahali pengine kwenye picha ukitaka kubadilisha."
              : "Bonyeza kwenye mdomo wa picha ili mdomo usogee na sauti."}
          </p>
        )}

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

        {prep && <p className="muted">{prep}</p>}
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
          Maneno yanasomwa na sauti ya AI, na harakati ya mdomo inafuata kelele ya sauti kwa wakati halisi. Hii ni
          mfano wa harakati, si lip-sync halisi. Picha inabaki kwenye kifaa chako.
        </p>
      </div>
    </div>
  );
}
