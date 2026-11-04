export type Plan = {
  title: string;
  characters: { name: string; age: string; appearance: string; clothing: string }[];
  locations: { name: string; description: string }[];
  scenes: {
    summary: string;
    narration: string;
    shots: { prompt: string; characters: string[]; location?: string; duration_seconds: number }[];
  }[];
};

type Input = {
  topic: string;
  type: string;
  language: string;
  style: string;
  scenes: number;
  shotsPerScene: number;
};

const SYSTEM = `You are a film director and documentary writer. You turn a topic into a shot-by-shot production plan for an AI video pipeline.

Rules for consistency (critical):
- Define every recurring person ONCE in "characters" with a very specific, visually distinctive appearance: age, build, skin tone, face shape, hair, facial hair, and fixed clothing. Characters must look clearly different from each other (different ages, builds, ethnicities, hairstyles).
- In shots, refer to people by NAME only. Never re-describe their faces inside a shot prompt.
- Keep each shot to ONE simple action, 5 or 10 seconds, one camera move.
- Shots with no people (landscapes, objects, archive-style b-roll) have an empty "characters" array.
- Shot prompts are written in English, visual only (no dialogue, no text on screen).
- "narration" is written in the requested language, natural spoken style, about 12 words per 5 seconds of footage in the scene.

Return ONLY valid JSON, no markdown, matching exactly:
{"title": string,
 "characters": [{"name": string, "age": string, "appearance": string, "clothing": string}],
 "locations": [{"name": string, "description": string}],
 "scenes": [{"summary": string, "narration": string,
   "shots": [{"prompt": string, "characters": [string], "location": string, "duration_seconds": 5 or 10}]}]}`;

function userPrompt(input: Input) {
  const lang = input.language === "sw" ? "Swahili" : "English";
  return `Type: ${input.type}
Topic: ${input.topic}
Narration language: ${lang}
Visual style: ${input.style || "realistic, cinematic"}
Create exactly ${input.scenes} scenes with exactly ${input.shotsPerScene} shots each.`;
}

function parse(text: string): Plan {
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean) as Plan;
}

// --- Gemini (free tier available via Google AI Studio) ---
async function viaGemini(input: Input): Promise<Plan> {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": process.env.GEMINI_API_KEY!,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: userPrompt(input) }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192, temperature: 0.8 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = await res.json();
  const parts: { text?: string }[] = json.candidates?.[0]?.content?.parts ?? [];
  return parse(parts.map((p) => p.text ?? "").join(""));
}

// --- Claude ---
async function viaClaude(input: Input): Promise<Plan> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt(input) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = await res.json();
  const text: string = (json.content ?? []).map((b: { text?: string }) => b.text ?? "").join("");
  return parse(text);
}

// --- Demo (no API key, no cost) ---
function demoPlan(input: Input): Plan {
  const sw = input.language === "sw";
  const title = input.topic.length > 60 ? `${input.topic.slice(0, 57)}...` : input.topic;

  return {
    title,
    characters: [
      {
        name: "Amani",
        age: "45",
        appearance: "Stocky man, dark brown skin, round face, short grey-flecked beard, shaved head, deep smile lines",
        clothing: "faded blue cotton shirt and khaki shorts",
      },
      {
        name: "Neema",
        age: "28",
        appearance: "Slim woman, medium brown skin, oval face, long braided hair, high cheekbones",
        clothing: "yellow kitenge dress with a white headscarf",
      },
    ],
    locations: [{ name: "Pwani", description: "Sunlit East African coastline with wooden boats and palm trees" }],
    scenes: Array.from({ length: input.scenes }, (_, i) => ({
      summary: sw ? `Onyesho la mfano ${i + 1}` : `Sample scene ${i + 1}`,
      narration: sw
        ? "Hii ni simulizi ya mfano kutoka hali ya majaribio. Ukiweka funguo ya AI, hapa patakuwa na simulizi halisi kuhusu mada yako."
        : "This is sample narration from demo mode. With an AI key set, real narration about your topic appears here.",
      shots: Array.from({ length: input.shotsPerScene }, (_, j) => ({
        prompt:
          j === 0
            ? "Amani pulls a wooden fishing net on the beach at sunrise, slow push-in"
            : j === 1
              ? "Amani and Neema talk beside a wooden boat, soft golden light, gentle handheld camera"
              : "Wide shot of turquoise waves rolling onto an empty white-sand beach, slow pan",
        characters: j === 0 ? ["Amani"] : j === 1 ? ["Amani", "Neema"] : [],
        location: "Pwani",
        duration_seconds: 5,
      })),
    })),
  };
}

export async function planProject(input: Input): Promise<Plan> {
  if (process.env.GEMINI_API_KEY) return viaGemini(input);
  if (process.env.ANTHROPIC_API_KEY) return viaClaude(input);
  if (process.env.DEMO_MODE === "true") return demoPlan(input);
  throw new Error("Hakuna funguo ya AI. Weka GEMINI_API_KEY, ANTHROPIC_API_KEY, au DEMO_MODE=true.");
}
