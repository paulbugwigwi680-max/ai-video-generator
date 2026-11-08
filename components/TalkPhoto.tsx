"use client";

import { useEffect, useRef, useState } from "react";
import { pickVoice, voicesFor } from "@/lib/voices";
import { AI_VOICES, DEFAULT_AI_VOICE } from "@/lib/tts-voices";
import { fetchNarration, newAudioContext } from "@/lib/narration-client";
import { uploadToCloudinary } from "@/lib/cloudinary-client";
import { analyzeNarration, fadeOutMaster, makeMaster, playFaded } from "@/lib/audio-utils";
import { blurredBackground, fitRect } from "@/lib/frame-fit";
import { canExportMp4, renderMp4 } from "@/lib/mp4-render";

type Mode = "talk" | "song";
type Ratio = "wide" | "tall";
type Mouth = { x: number; y: number }; // position on the photo, 0..1
type Photo = { id: number; img: HTMLImageElement; url: string; mouth: Mouth | null };

const MAX_PHOTOS = 6;
const START = 0.4; // seconds before the voice starts
const TAIL = 0.9; // silent, fading-out ending

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

// With several photos, they follow each other as the words go on.
const photoIndex = (seg: number, nSeg: number, nPhotos: number) =>
  Math.min(nPhotos - 1, Math.floor((seg * nPhotos) / Math.max(1, nSeg)));

function makeBounds(segments: string[], D: number) {
  const weights = segments.map((s) => s.length + 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const bounds: number[] = [];
  let acc = 0;
  for (const w of weights) {
    bounds.push((acc / sum) * D);
    acc += w;
  }
  bounds.push(D);
  return bounds;
}

function segmentAt(el: number, D: number, bounds: number[], nSeg: number) {
  const e = Math.min(Math.max(el, 0), D - 0.001);
  let seg = 0;
  while (seg < nSeg - 1 && e >= bounds[seg + 1]) seg++;
  const p = Math.min(1, Math.max(0, (e - bounds[seg]) / Math.max(0.1, bounds[seg + 1] - bounds[seg])));
  return { seg, p };
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
  photo: Photo | null,
  text: string,
  progress: number,
  amp: number, // 0..1 loudness of the voice right now
  mode: Mode,
  t: number,
  showMarker: boolean,
  fade: number // 0..1 black overlay (clean start and end)
) {
  ctx.fillStyle = "#0b1218";
  ctx.fillRect(0, 0, W, H);

  const img = photo?.img;
  if (photo && img && img.complete && img.naturalWidth) {
    // The whole person stays in the picture: never cropped, only a very gentle breathing zoom.
    const zoom = 1 + 0.01 * Math.sin(t * 1.3) + 0.005 * amp;
    const r0 = fitRect(img.naturalWidth, img.naturalHeight, W, H, zoom);
    const dy = r0.dy + 2 * amp * Math.sin(t * 7.5);
    const { dx, dw, dh } = r0;
    if (r0.contain) ctx.drawImage(blurredBackground(img, W, H), 0, 0);
    ctx.drawImage(img, dx, dy, dw, dh);

    // Mouth movement: the lower face is lowered a little with the voice (amplitude driven).
    const mouth = photo.mouth;
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
    ctx.fillStyle = `rgba(14,124,134,${0.06 + 0.06 * Math.abs(Math.sin(t * 4))})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Caption area
  const gh = Math.round(H * 0.3);
  const grad = ctx.createLinearGradient(0, H - gh, 0, H);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.78)");
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
  const cancelRef = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const photosRef = useRef<Photo[]>([]);
  const nextId = useRef(1);

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [sel, setSel] = useState(0);
  const [consent, setConsent] = useState(false);
  const [script, setScript] = useState("");
  const [mode, setMode] = useState<Mode>("talk");
  const [lang, setLang] = useState<"sw" | "en">("sw");
  const [ratio, setRatio] = useState<Ratio>("wide");

  const [voiceMode, setVoiceMode] = useState<"ai" | "device">("ai");
  const [aiVoice, setAiVoice] = useState(DEFAULT_AI_VOICE);
  const [style, setStyle] = useState("");
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [deviceVoice, setDeviceVoice] = useState("");
  const [rate, setRate] = useState(0.95);
  const [pitch, setPitch] = useState(1);

  const [prep, setPrep] = useState("");
  const [playing, setPlaying] = useState(false);
  const [exportPct, setExportPct] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const [lastName, setLastName] = useState("picha-inayoongea.mp4");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  photosRef.current = photos;
  const size = SIZES[ratio];
  const working = prep !== "" || exportPct !== null;
  const canRun = consent && photos.length > 0 && script.trim().length > 0 && !working;
  const styleText = () => style.trim() || (mode === "song" ? "in a melodic, rhythmic, sing-song way" : "");

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

  // Idle preview: the selected photo.
  useEffect(() => {
    if (playing || exportPct !== null) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const first = toSegments(script, mode)[0] ?? "";
    drawScene(ctx, size.w, size.h, photos[sel] ?? null, first, 0, 0, mode, 0, true, 0);
  }, [photos, sel, ratio, script, mode, playing, exportPct, size.w, size.h]);

  useEffect(() => () => cancelRef.current?.(), []);

  async function onPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files: File[] = Array.from((e.target.files ?? []) as ArrayLike<File>);
    e.target.value = "";
    if (!files.length) return;
    setMsg("");
    const room = MAX_PHOTOS - photosRef.current.length;
    if (room <= 0) {
      setMsg(`Unaweza kuweka picha ${MAX_PHOTOS} tu.`);
      return;
    }
    const added: Photo[] = [];
    for (const file of files.slice(0, room)) {
      if (!file.type.startsWith("image/")) {
        setMsg("Faili moja si picha, imeachwa.");
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setMsg("Picha moja ni kubwa mno (kikomo MB 10), imeachwa.");
        continue;
      }
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error("Picha haisomeki."));
          i.src = url;
        });
        added.push({ id: nextId.current++, img, url, mouth: null });
      } catch {
        URL.revokeObjectURL(url);
        setMsg("Picha moja haisomeki, imeachwa.");
      }
    }
    if (files.length > room) setMsg(`Picha ${room} tu zimeongezwa (kikomo ni ${MAX_PHOTOS}).`);
    if (added.length) {
      setPhotos((prev) => [...prev, ...added]);
      setSel(photosRef.current.length);
    }
  }

  function removePhoto(i: number) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[i]?.url ?? "");
      return prev.filter((_, k) => k !== i);
    });
    setSel((s) => Math.max(0, Math.min(s, photosRef.current.length - 2)));
  }

  // Click on the photo to mark where the mouth is (each photo has its own mouth).
  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const p = photos[sel];
    if (!canvas || !p || playing || exportPct !== null) return;
    const r = canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * size.w;
    const cy = ((e.clientY - r.top) / r.height) * size.h;
    const f = fitRect(p.img.naturalWidth, p.img.naturalHeight, size.w, size.h, 1);
    const mouth = { x: (cx - f.dx) / f.dw, y: (cy - f.dy) / f.dh };
    setPhotos((prev) => prev.map((q, k) => (k === sel ? { ...q, mouth } : q)));
  }

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

  // ---------- MP4 export: exact, frame by frame, with clean audio ----------
  async function exportMp4() {
    const canvas = canvasRef.current;
    if (!canvas || !canRun || busyRef.current) return;
    const segments = toSegments(script, mode);
    if (!segments.length) {
      setMsg("Andika maneno kwanza.");
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!canExportMp4()) {
      setMsg("Kivinjari hiki hakiwezi kutengeneza MP4. Tumia Chrome au Edge ya kisasa.");
      return;
    }
    if (voiceMode !== "ai") {
      setMsg("MP4 inahitaji 'Sauti ya AI', kwa sababu sauti ya kifaa haiwezi kuingia kwenye video.");
      return;
    }
    busyRef.current = true;
    stop();
    setMsg("");
    setShareUrl(null);
    setExportPct(0);

    try {
      setPrep("Inaandaa sauti ya AI…");
      const dec = new OfflineAudioContext(1, 1, 48000);
      const narr = analyzeNarration(await fetchNarration(dec, segments.join("\n").slice(0, 1800), aiVoice, styleText()));
      setPrep("");

      const D = narr.dur;
      const total = START + D + TAIL;
      const sr = 48000;
      const off = new OfflineAudioContext(1, Math.ceil(total * sr), sr);
      const master = makeMaster(off, null);
      playFaded(off, master, narr, START);
      fadeOutMaster(master, START + D + 0.15, 0.55);
      const rendered = await off.startRendering();
      const pcm = rendered.getChannelData(0);

      const bounds = makeBounds(segments, D);
      const list = photosRef.current;
      let amp = 0;

      const blob = await renderMp4({
        canvas,
        width: size.w,
        height: size.h,
        duration: total,
        audio: rendered,
        onProgress: setExportPct,
        drawAt: (t) => {
          const el = t - START;
          const { seg, p } = segmentAt(el, D, bounds, segments.length);
          // loudness of the real audio around this frame drives the mouth
          const c = Math.round(t * sr);
          const half = Math.round(sr * 0.025);
          let s2 = 0;
          let n = 0;
          for (let i = Math.max(0, c - half); i < Math.min(pcm.length, c + half); i += 4) {
            s2 += pcm[i] * pcm[i];
            n++;
          }
          amp = amp * 0.5 + Math.min(1, Math.sqrt(s2 / Math.max(1, n)) * 5) * 0.5;
          const fadeIn = Math.max(0, 1 - t / 0.4);
          const fadeOut = Math.max(0, (el - (D + 0.15)) / (TAIL - 0.15));
          drawScene(
            ctx, size.w, size.h, list[photoIndex(seg, segments.length, list.length)], segments[seg], p,
            el >= 0 && el <= D ? amp : 0, mode, t, false, Math.max(fadeIn, fadeOut)
          );
        },
      });
      saveBlob(blob, "picha-inayoongea.mp4");
    } catch (e) {
      const m = (e as Error).message;
      setMsg(m === "AAC_UNSUPPORTED" ? "Kivinjari hiki hakiwezi kuweka sauti kwenye MP4. Tumia Chrome au Edge." : `Imeshindwa: ${m}`);
    }
    setPrep("");
    setExportPct(null);
    busyRef.current = false;
  }

  // ---------- Live playback ----------
  async function start() {
    const canvas = canvasRef.current;
    if (!canvas || !canRun || busyRef.current) return;
    const segments = toSegments(script, mode);
    if (!segments.length) {
      setMsg("Andika maneno kwanza.");
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    busyRef.current = true;
    stop();
    setMsg("");
    setShareUrl(null);
    const list = photosRef.current;

    // 1. AI narration of the WHOLE script.
    let actx: AudioContext | null = null;
    let narr: ReturnType<typeof analyzeNarration> | null = null;
    if (voiceMode === "ai") {
      try {
        actx = newAudioContext();
        await actx.resume();
        setPrep("Inaandaa sauti ya AI…");
        const buf = await fetchNarration(actx, segments.join("\n").slice(0, 1800), aiVoice, styleText());
        narr = analyzeNarration(buf);
      } catch (e) {
        setMsg(`${(e as Error).message} Inatumika sauti ya kifaa badala yake.`);
        actx?.close().catch(() => {});
        actx = null;
        narr = null;
      }
      setPrep("");
    }
    const ai = !!actx && !!narr;

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
      const ac = actx;
      if (ac) window.setTimeout(() => ac.close().catch(() => {}), 900);
      setPlaying(false);
      cancelRef.current = null;
      busyRef.current = false;
    };

    cancelRef.current = finish;
    setPlaying(true);

    if (ai && actx && narr) {
      // ---- AI voice: everything follows the audio clock and the real loudness ----
      const D = narr.dur;
      const bounds = makeBounds(segments, D);
      const master = makeMaster(actx, null);
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.connect(master);
      const audioStart = actx.currentTime + START;
      src = playFaded(actx, analyser, narr, audioStart);
      fadeOutMaster(master, audioStart + D + 0.15, 0.55);

      const tick = () => {
        const now = (performance.now() - t0) / 1000;
        const el = actx!.currentTime - audioStart;
        if (el > D + TAIL) {
          finish();
          return;
        }
        const { seg, p } = segmentAt(el, D, bounds, segments.length);

        analyser!.getByteTimeDomainData(levels);
        let s2 = 0;
        for (let i = 0; i < levels.length; i++) {
          const v = (levels[i] - 128) / 128;
          s2 += v * v;
        }
        amp = amp * 0.5 + Math.min(1, Math.sqrt(s2 / levels.length) * 5) * 0.5;

        const fadeIn = Math.max(0, 1 - now / 0.4);
        const fadeOut = Math.max(0, (el - (D + 0.15)) / (TAIL - 0.15));
        drawScene(
          ctx, size.w, size.h, list[photoIndex(seg, segments.length, list.length)], segments[seg], p,
          el >= 0 && el <= D ? amp : 0, mode, now, false, Math.max(fadeIn, fadeOut)
        );
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return;
    }

    // ---- Device voice ----
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
        timers.push(window.setTimeout(finish, 900));
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
      const seg = Math.min(run.seg, segments.length - 1);
      drawScene(
        ctx, size.w, size.h, list[photoIndex(seg, segments.length, list.length)], segments[seg], p,
        fakeAmp, mode, (now - t0) / 1000, false, fadeIn
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

  const current = photos[sel];

  return (
    <div className="talk">
      <div className="panel">
        <label htmlFor="photo">1. Picha (hadi {MAX_PHOTOS})</label>
        <input id="photo" type="file" accept="image/*" multiple onChange={onPhotos} disabled={working || playing} />
        {photos.length > 0 && (
          <div className="thumbs">
            {photos.map((p, i) => (
              <div key={p.id} className={`thumb${i === sel ? " on" : ""}`}>
                <button type="button" className="thumb-btn" onClick={() => setSel(i)} aria-label={`Picha ${i + 1}`}>
                  <img src={p.url} alt="" />
                </button>
                <button type="button" className="thumb-x" onClick={() => removePhoto(i)} aria-label={`Ondoa picha ${i + 1}`} disabled={working || playing}>×</button>
              </div>
            ))}
          </div>
        )}
        {photos.length > 1 && (
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 6 }}>
            Picha zinafuatana kadri maneno yanavyoendelea. Bonyeza picha kuichagua, kisha bonyeza kwenye mdomo wake.
          </p>
        )}

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
            Nathibitisha kwamba nina ruhusa ya kutumia picha hizi, na sijifanyi mtu mwingine wala mtu maarufu.
          </span>
        </label>
      </div>

      <div>
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          onClick={onCanvasClick}
          style={{ width: "100%", maxWidth: ratio === "tall" ? 360 : 760, cursor: current && !playing ? "crosshair" : "default" }}
        />
        {current && !playing && (
          <p className="muted" style={{ marginTop: 8 }}>
            {current.mouth
              ? "Mdomo wa picha hii umewekwa (duara la dhahabu). Bonyeza mahali pengine kubadilisha."
              : "Bonyeza kwenye mdomo wa picha ili mdomo usogee na sauti."}
          </p>
        )}

        <div className="controls" style={{ marginTop: 12 }}>
          {!playing ? (
            <>
              <button onClick={start} disabled={!canRun}>▶ Cheza</button>
              <button className="ghost" onClick={exportMp4} disabled={!canRun}>⬇ Pakua MP4</button>
            </>
          ) : (
            <button onClick={stop}>■ Simama</button>
          )}
        </div>

        {prep && <p className="muted">{prep}</p>}
        {exportPct !== null && <p className="muted">Inatengeneza MP4… {exportPct}%. Acha ukurasa wazi hadi imalize.</p>}
        {msg && <p className="msg">{msg}</p>}
        {!consent && photos.length > 0 && <p className="muted">Thibitisha ruhusa ya picha ili kuendelea.</p>}

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
          Picha zinaonyeshwa nzima ili watu wasikatwe. Maneno yanasomwa na sauti ya AI, na harakati ya mdomo inafuata
          kelele ya sauti. Hii ni mfano wa harakati, si lip-sync halisi. Picha zinabaki kwenye kifaa chako.
        </p>
      </div>
    </div>
  );
}
