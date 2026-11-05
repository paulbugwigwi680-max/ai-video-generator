// Gemini TTS voices offered in the app (same voices work for Swahili and English).
// Gender labels follow Google's voice list; listen and pick the one you like.
export type AiVoice = { id: string; label: string; gender: "f" | "m" };

export const AI_VOICES: AiVoice[] = [
  { id: "Kore", label: "Kore · kike, sauti imara", gender: "f" },
  { id: "Aoede", label: "Aoede · kike, laini", gender: "f" },
  { id: "Leda", label: "Leda · kike, ujana", gender: "f" },
  { id: "Sulafat", label: "Sulafat · kike, joto", gender: "f" },
  { id: "Puck", label: "Puck · kiume, mchangamfu", gender: "m" },
  { id: "Charon", label: "Charon · kiume, mwenye maelezo", gender: "m" },
  { id: "Orus", label: "Orus · kiume, imara", gender: "m" },
  { id: "Fenrir", label: "Fenrir · kiume, mwenye hamasa", gender: "m" },
];

export const AI_VOICE_IDS = AI_VOICES.map((v) => v.id);
export const DEFAULT_AI_VOICE = "Kore";
