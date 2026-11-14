"use client";

import { useRef, useState } from "react";
import { fetchNarration, newAudioContext } from "@/lib/narration-client";
import { finalizeMix, loudness, makeMaster, fadeOutMaster, playFaded, analyzeNarration } from "@/lib/audio-utils";
import { scheduleBeat } from "@/lib/beat";
import { renderMp4 } from "@/lib/mp4-render";

type Line = { ok: boolean | null; text: string };

// Self-test page: checks every step of the sound chain on THIS phone / computer and says exactly what fails.
export default function SautiTest() {
  const [log, setLog] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const add = (ok: boolean | null, text: string) => setLog((l) => [...l, { ok, text }]);

  async function playTone() {
    setLog([]);
    try {
      const ac = newAudioContext();
      await ac.resume();
      add(null, `AudioContext: hali = ${ac.state}, sampleRate = ${ac.sampleRate}`);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = 523;
      g.gain.value = 0.25;
      o.connect(g);
      g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + 1.2);
      add(null, "Mlio wa 'biiiip' wa sekunde 1 unachezwa sasa. Je, umeusikia? Kama HUKUUSIKIA: ongeza volume ya simu/kompyuta, toa silent mode (iPhone: swichi ya pembeni), na ujaribu tena.");
      setTimeout(() => ac.close().catch(() => {}), 1800);
    } catch (e) {
      add(false, `Kivinjari hakiwezi kucheza sauti: ${(e as Error).message}`);
    }
  }

  async function testBeat() {
    setLog([]);
    setBusy(true);
    try {
      // 1) offline render: proves the beat itself makes sound
      const sr = 48000;
      const off = new OfflineAudioContext(1, sr * 4, sr);
      const m = makeMaster(off, null);
      scheduleBeat(off, m, 0, 4, []);
      const buf = await off.startRendering();
      const l = loudness(buf);
      add(l.peak > 0.02, `Beat (imetengenezwa kimya kimya): peak = ${l.peak.toFixed(3)}, rms = ${l.rms.toFixed(3)} ${l.peak > 0.02 ? "→ beat ina sauti" : "→ BEAT NI KIMYA (tatizo liko kwenye beat)"}`);

      // 2) live playback
      const ac = newAudioContext();
      await ac.resume();
      const master = makeMaster(ac, null);
      const a0 = ac.currentTime + 0.1;
      scheduleBeat(ac, master, a0, 6, []);
      fadeOutMaster(master, a0 + 5.3, 0.6);
      add(null, "Beat inachezwa sasa kwa sekunde 6. Je, unaisikia?");
      setTimeout(() => ac.close().catch(() => {}), 7500);
    } catch (e) {
      add(false, `Jaribio la beat limeshindwa: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  async function testVoice() {
    setLog([]);
    setBusy(true);
    try {
      const ac = newAudioContext();
      await ac.resume();
      add(null, "Naomba sauti ya AI kutoka kwenye server…");
      const buf = await fetchNarration(ac, "Habari, hii ni sauti ya majaribio ya BUGWIGWI.", "Kore");
      const l = loudness(buf);
      add(l.peak > 0.02, `Sauti ya AI imepokelewa: urefu ${buf.duration.toFixed(1)}s, peak = ${l.peak.toFixed(3)} ${l.peak > 0.02 ? "" : "→ NI KIMYA"}`);
      const n = analyzeNarration(buf);
      const master = makeMaster(ac, null);
      playFaded(ac, master, n, ac.currentTime + 0.1);
      add(null, "Sauti ya AI inachezwa sasa. Je, unaisikia?");
      setTimeout(() => ac.close().catch(() => {}), (n.dur + 1.5) * 1000);
    } catch (e) {
      add(false, `Sauti ya AI imeshindwa: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  async function testMp4() {
    setLog([]);
    setVideoUrl(null);
    setBusy(true);
    try {
      const g = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      add(!!g.VideoEncoder, `VideoEncoder: ${g.VideoEncoder ? "ipo" : "HAIPO"}`);
      add(!!g.AudioEncoder, `AudioEncoder: ${g.AudioEncoder ? "ipo" : "HAIPO (kivinjari hiki hakiwezi kuweka sauti kwenye MP4)"}`);
      if (g.AudioEncoder) {
        for (const [name, cfg] of [
          ["AAC", { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 1, bitrate: 128000 }],
          ["Opus", { codec: "opus", sampleRate: 48000, numberOfChannels: 1, bitrate: 96000 }],
        ] as const) {
          const s = await g.AudioEncoder.isConfigSupported(cfg).catch(() => null);
          add(!!s?.supported, `${name}: ${s?.supported ? "inaungwa mkono" : "haiungwi mkono"}`);
        }
      }

      const sr = 48000;
      const dur = 4;
      const off = new OfflineAudioContext(1, sr * dur, sr);
      const m = makeMaster(off, null);
      scheduleBeat(off, m, 0, dur, []);
      fadeOutMaster(m, dur - 0.7, 0.55);
      const mix = await off.startRendering();
      finalizeMix(mix, 0.9);
      add(loudness(mix).peak > 0.02, `Sauti ya kuweka kwenye video: peak = ${loudness(mix).peak.toFixed(3)}`);

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      let codec = "?";
      const blob = await renderMp4({
        canvas,
        width: canvas.width,
        height: canvas.height,
        duration: dur,
        audio: mix,
        onAudioCodec: (c) => (codec = c),
        drawAt: (t) => {
          ctx.fillStyle = "#0a5c64";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#fff";
          ctx.font = "bold 40px sans-serif";
          ctx.fillText(`Jaribio ${t.toFixed(1)}s`, 40, 120);
        },
      });
      add(true, `MP4 imetengenezwa (${(blob.size / 1024).toFixed(0)} KB), sauti ya faili: ${codec.toUpperCase()}`);

      try {
        const dec = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
        const l = loudness(dec);
        add(l.peak > 0.02, `Nimefungua faili tena: sauti ndani yake peak = ${l.peak.toFixed(3)} ${l.peak > 0.02 ? "→ FAILI LINA SAUTI" : "→ FAILI HALINA SAUTI"}`);
      } catch (e) {
        add(null, `Kivinjari hakiwezi kusoma sauti ya faili hili (${(e as Error).message}). Hiyo haimaanishi ni kimya: cheza video hapa chini.`);
      }
      setVideoUrl(URL.createObjectURL(blob));
      add(null, "Cheza video hapa chini. Je, unasikia beat? Kama HAUSIKII hapa lakini majaribio ya juu yalisema faili lina sauti, tatizo ni kicheza video / volume ya kifaa.");
    } catch (e) {
      add(false, `Jaribio la MP4 limeshindwa: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  return (
    <main className="wrap">
      <h1>Jaribio la sauti</h1>
      <p className="muted">
        Fanya majaribio haya kwa mpangilio (1 hadi 4) kwenye simu yako na kwenye kompyuta, kisha nitumie picha ya skrini au andika kilichotokea.
        Kila jaribio linacheza sauti kweli, kwa hiyo ongeza volume kwanza.
      </p>
      <div className="bulk">
        <button onClick={playTone} disabled={busy}>1. Mlio wa kawaida</button>
        <button onClick={testBeat} disabled={busy}>2. Beat</button>
        <button onClick={testVoice} disabled={busy}>3. Sauti ya AI</button>
        <button onClick={testMp4} disabled={busy}>4. Faili la MP4</button>
      </div>

      <ul style={{ listStyle: "none", padding: 0, marginTop: 20 }}>
        {log.map((l, i) => (
          <li key={i} style={{ margin: "8px 0", fontWeight: 600, color: l.ok === false ? "var(--coral)" : l.ok ? "var(--sea-dark)" : "var(--ink)" }}>
            {l.ok === true ? "✔ " : l.ok === false ? "✘ " : "• "}
            {l.text}
          </li>
        ))}
      </ul>

      <canvas ref={canvasRef} width={640} height={360} style={{ display: "none" }} />
      {videoUrl && (
        <>
          <video src={videoUrl} controls playsInline style={{ width: "100%", maxWidth: 640, background: "#000" }} />
          <p>
            <a href={videoUrl} download="jaribio-sauti.mp4">Pakua faili hili la majaribio</a>
          </p>
        </>
      )}
    </main>
  );
}
