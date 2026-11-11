import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { AI_VOICE_IDS, DEFAULT_AI_VOICE } from "@/lib/tts-voices";

export const maxDuration = 60;

const env = (name: string) => process.env[name] ?? process.env[name.toLowerCase()];

// Gemini returns raw 16-bit mono PCM; browsers need a WAV header to decode it.
function wavFromPcm(pcm: Buffer, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

type GeminiPart = { inlineData?: { data?: string; mimeType?: string } };

async function synth(model: string, key: string, text: string, voice: string) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
    signal: AbortSignal.timeout(27000),
  });
  if (!res.ok) return { status: res.status as number, wav: null as Buffer | null };

  const json = await res.json();
  const parts: GeminiPart[] = json.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) return { status: 502, wav: null };
  const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? "")?.[1] ?? 24000);
  return { status: 200, wav: wavFromPcm(Buffer.from(inline.data, "base64"), rate) };
}

export async function POST(req: Request) {
  const { user } = await getUser();
  if (!user) return NextResponse.json({ error: "Ingia kwanza." }, { status: 401 });

  const key = env("GEMINI_API_KEY");
  if (!key) return NextResponse.json({ error: "Funguo ya Gemini haijawekwa." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  let spoken = String(body.text ?? "").trim().slice(0, 1800);
  if (!spoken) return NextResponse.json({ error: "Hakuna maneno ya kusoma." }, { status: 400 });
  // A sentence that ends with punctuation lets the voice finish cleanly (no trailing noise).
  if (!/[.!?…]$/.test(spoken)) spoken += ".";
  const voice = AI_VOICE_IDS.includes(body.voice) ? (body.voice as string) : DEFAULT_AI_VOICE;
  const style = String(body.style ?? "").trim().slice(0, 160);
  // Natural-language style steers the delivery (e.g. "in a melodic, rhythmic way").
  const text = style ? `Say ${style}: ${spoken}` : spoken;

  const models = Array.from(
    new Set([env("GEMINI_TTS_MODEL") ?? "gemini-3.1-flash-tts-preview", env("GEMINI_TTS_FALLBACK_MODEL") ?? "gemini-2.5-flash-preview-tts"])
  );

  let lastStatus = 502;
  for (const model of models) {
    try {
      const out = await synth(model, key, text, voice);
      if (out.wav) {
        return new NextResponse(new Uint8Array(out.wav), {
          headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=3600" },
        });
      }
      lastStatus = out.status;
      // Non-temporary errors (e.g. invalid key) will not improve with another model.
      if (![404, 429, 500, 502, 503, 504].includes(out.status)) break;
    } catch {
      lastStatus = 504;
    }
  }

  const message =
    lastStatus === 429
      ? "Kikomo cha bure cha sauti ya AI kimefika. Jaribu tena baadaye."
      : lastStatus === 401 || lastStatus === 403
        ? "Funguo ya Gemini haikubaliwi kwa huduma ya sauti."
        : "Huduma ya sauti ya AI ina msongamano sasa. Jaribu tena baada ya muda mfupi.";
  return NextResponse.json({ error: message }, { status: 503 });
}
