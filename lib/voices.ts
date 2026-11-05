// Helpers for the voices installed on the user's device (Web Speech API).
const norm = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
const natural = (v: SpeechSynthesisVoice) => /natural|online/i.test(v.name);

// All device voices for a language ("sw" = Swahili, anything else = English).
export function voicesFor(voices: SpeechSynthesisVoice[], language: string): SpeechSynthesisVoice[] {
  const prefix = language === "sw" ? "sw" : "en";
  const byLang = voices.filter((v) => norm(v).startsWith(prefix));
  const list =
    byLang.length || language !== "sw" ? byLang : voices.filter((v) => /swahili|kiswahili/i.test(v.name));
  return [...list].sort((a, b) => Number(natural(b)) - Number(natural(a)));
}

// Picks a device voice: the one the user chose, otherwise the best available.
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  language: string,
  preferredName?: string
): SpeechSynthesisVoice | null {
  const list = voicesFor(voices, language);
  if (preferredName) {
    const chosen = list.find((v) => v.name === preferredName);
    if (chosen) return chosen;
  }
  if (language === "sw") {
    return (
      list.find((v) => natural(v) && norm(v) === "sw-tz") ??
      list.find(natural) ??
      list.find((v) => norm(v) === "sw-tz") ??
      list[0] ??
      null
    );
  }
  return list.find(natural) ?? list[0] ?? null;
}
