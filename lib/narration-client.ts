// Browser helpers: fetch AI narration (Gemini TTS) and decode it for the Web Audio API.
const cache = new Map<string, ArrayBuffer>();

export function newAudioContext(): AudioContext {
  const AC =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new AC();
}

export async function fetchNarration(
  ctx: BaseAudioContext,
  text: string,
  voice: string,
  style = ""
): Promise<AudioBuffer> {
  const key = `${voice}|${style}|${text}`;
  let data = cache.get(key);
  if (!data) {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, style }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Sauti ya AI imeshindikana (${res.status}).`);
    }
    data = await res.arrayBuffer();
    cache.set(key, data);
  }
  return ctx.decodeAudioData(data.slice(0));
}
