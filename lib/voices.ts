// Picks the best device voice for a language ("sw" = Swahili, anything else = English).
export function pickVoice(voices: SpeechSynthesisVoice[], language: string): SpeechSynthesisVoice | null {
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
