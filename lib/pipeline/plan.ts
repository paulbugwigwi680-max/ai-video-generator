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

export async function planProject(input: {
  topic: string;
  type: string;
  language: string;
  style: string;
  scenes: number;
  shotsPerScene: number;
}): Promise<Plan> {
  const lang = input.language === "sw" ? "Swahili" : "English";
  const user = `Type: ${input.type}
Topic: ${input.topic}
Narration language: ${lang}
Visual style: ${input.style || "realistic, cinematic"}
Create exactly ${input.scenes} scenes with exactly ${input.shotsPerScene} shots each.`;

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
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = await res.json();
  const text: string = (json.content ?? []).map((b: { text?: string }) => b.text ?? "").join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean) as Plan;
}
