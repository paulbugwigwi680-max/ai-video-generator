import { after } from "next/server";
import { appUrl } from "@/lib/config";

export type HookKind = "character" | "keyframe" | "video";

// Accept both UPPERCASE and lowercase variable names.
const env = (name: string) => process.env[name] ?? process.env[name.toLowerCase()];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hookUrl(kind: HookKind, id: string) {
  const hook = new URL(`${appUrl()}/api/webhooks/fal`);
  hook.searchParams.set("kind", kind);
  hook.searchParams.set("id", id);
  hook.searchParams.set("secret", process.env.WEBHOOK_SECRET ?? "");
  return hook.toString();
}

// ---------------------------------------------------------------------------
// Free picture generators (used only in DEMO_MODE). Two providers, tried in order:
//   1. Cloudflare Workers AI (FLUX schnell)  - about 170 pictures per day
//   2. Google Gemini image model             - separate daily allowance, uses your Gemini key
// When one is used up for the day, the next one takes over automatically.
// ---------------------------------------------------------------------------
class ProviderError extends Error {
  quota: boolean;
  constructor(message: string, quota = false) {
    super(message);
    this.quota = quota;
  }
}

const nextUtcMidnight = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

// ---- 1. Cloudflare ----
let cloudflareBlockedUntil = 0; // remembered while the daily allowance is used up

async function cloudflareImage(prompt: string): Promise<string> {
  if (Date.now() < cloudflareBlockedUntil) {
    throw new ProviderError("Cloudflare: kikomo cha leo kimeisha.", true);
  }
  const account = env("CLOUDFLARE_ACCOUNT_ID");
  const token = env("CLOUDFLARE_API_TOKEN");
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 4 }),
      signal: AbortSignal.timeout(40000),
    }
  );
  const json = await res.json().catch(() => ({}));
  const b64: string | undefined = json?.result?.image;
  if (!res.ok || !b64) {
    const detail = String(json?.errors?.[0]?.message ?? `status ${res.status}`);
    const quota = res.status === 429 || /daily free allocation|neurons/i.test(detail);
    if (quota) cloudflareBlockedUntil = nextUtcMidnight();
    throw new ProviderError(`Cloudflare AI: ${detail}`, quota);
  }
  return `data:image/jpeg;base64,${b64}`;
}

// ---- 2. Gemini image models ----
let geminiModelsCache: string[] | null = null;

// Finds the image-capable Gemini models available to this key (names change often).
async function geminiImageModels(key: string): Promise<string[]> {
  if (geminiModelsCache) return geminiModelsCache;
  const found: string[] = [];
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const json = await res.json();
      for (const m of json.models ?? []) {
        const name = String(m.name ?? "").replace(/^models\//, "");
        const methods: string[] = m.supportedGenerationMethods ?? [];
        if (/image/i.test(name) && !/imagen/i.test(name) && methods.includes("generateContent")) found.push(name);
      }
    }
  } catch {
    /* use the defaults below */
  }
  // models without "pro" first (the pro image models usually have no free allowance)
  found.sort((a, b) => Number(/pro/i.test(a)) - Number(/pro/i.test(b)));
  const forced = env("GEMINI_IMAGE_MODEL");
  geminiModelsCache = Array.from(new Set([forced, ...found, "gemini-2.5-flash-image"].filter((m): m is string => !!m)));
  return geminiModelsCache;
}

async function callGemini(model: string, key: string, prompt: string, aspect: string, withAspect: boolean) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        ...(withAspect ? { imageConfig: { aspectRatio: aspect } } : {}),
      },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const text = res.ok ? "" : await res.text().catch(() => "");
  const json = res.ok ? await res.json().catch(() => ({})) : null;
  return { ok: res.ok, status: res.status, text, json };
}

async function geminiImage(prompt: string, aspect: string): Promise<string> {
  const key = env("GEMINI_API_KEY");
  if (!key) throw new ProviderError("Gemini: funguo haijawekwa.");
  const started = Date.now();
  const models = await geminiImageModels(key);
  let last = new ProviderError("Gemini: hakuna modeli ya picha inayopatikana.");

  for (const model of models.slice(0, 3)) {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (Date.now() - started > 42000) throw last; // stay inside the time limit
      let r = await callGemini(model, key, prompt, aspect, true);
      if (r.status === 400) r = await callGemini(model, key, prompt, aspect, false); // model without aspect option

      if (r.ok) {
        const parts: { inlineData?: { mimeType?: string; data?: string } }[] = r.json?.candidates?.[0]?.content?.parts ?? [];
        const img = parts.find((p) => p.inlineData?.data && /^image\//.test(p.inlineData.mimeType ?? ""))?.inlineData;
        if (img?.data) {
          if (img.data.length > 4_000_000) throw new ProviderError("Gemini: picha imetoka kubwa mno.");
          return `data:${img.mimeType};base64,${img.data}`;
        }
        last = new ProviderError(`Gemini (${model}): haikurudisha picha.`);
        break;
      }

      const zero = /limit:\s*0/i.test(r.text); // this key has no free allowance for this model
      last = new ProviderError(`Gemini (${model}) ${r.status}: ${r.text.slice(0, 160)}`, r.status === 429);
      if (r.status === 429 && !zero) {
        await sleep(7000); // free tier allows about 10 requests per minute
        continue;
      }
      break; // try the next model
    }
  }
  throw last;
}

async function freeImage(prompt: string, aspect: string): Promise<string> {
  const hasCloudflare = !!(env("CLOUDFLARE_ACCOUNT_ID") && env("CLOUDFLARE_API_TOKEN"));
  const hasGemini = !!env("GEMINI_API_KEY");
  if (!hasCloudflare && !hasGemini) {
    throw new Error("Weka CLOUDFLARE_ACCOUNT_ID na CLOUDFLARE_API_TOKEN, au GEMINI_API_KEY, kwenye Vercel (picha za bure).");
  }

  const problems: ProviderError[] = [];
  if (hasCloudflare) {
    try {
      return await cloudflareImage(prompt);
    } catch (e) {
      problems.push(e instanceof ProviderError ? e : new ProviderError((e as Error).message));
    }
  }
  if (hasGemini) {
    try {
      return await geminiImage(prompt, aspect);
    } catch (e) {
      problems.push(e instanceof ProviderError ? e : new ProviderError((e as Error).message));
    }
  }

  if (problems.length && problems.every((p) => p.quota)) {
    throw new Error(
      "Picha za bure za leo zimeisha kwenye huduma zote. Zinarudi kesho saa 03:00 asubuhi (saa za Tanzania). Credits zako zimerudishwa."
    );
  }
  throw new Error(problems.map((p) => p.message).join(" | ").slice(0, 280));
}

/**
 * Submits a job to the fal.ai queue and returns immediately with a request id.
 * fal calls our webhook when the job is done, so Vercel never waits for generation.
 *
 * DEMO_MODE=true: nothing is sent to fal.ai. Pictures are generated for free (Cloudflare, then Gemini)
 * using the real prompts, and the "video" step is skipped (the player animates the pictures instead).
 */
export async function submitFal(model: string, input: Record<string, unknown>, kind: HookKind, id: string) {
  const hook = hookUrl(kind, id);

  if (env("DEMO_MODE") === "true") {
    if (kind !== "video" && !(env("GEMINI_API_KEY") || (env("CLOUDFLARE_ACCOUNT_ID") && env("CLOUDFLARE_API_TOKEN")))) {
      throw new Error("Weka CLOUDFLARE_ACCOUNT_ID na CLOUDFLARE_API_TOKEN, au GEMINI_API_KEY, kwenye Vercel (picha za bure).");
    }
    const requestId = `demo-${crypto.randomUUID()}`;
    const prompt = String(input.prompt ?? "");
    const aspect = kind === "character" ? "3:4" : "16:9";
    after(async () => {
      let body: Record<string, unknown>;
      try {
        const payload = kind === "video" ? { skip: true } : { images: [{ url: await freeImage(prompt, aspect) }] };
        body = { request_id: requestId, status: "OK", payload };
      } catch (e) {
        body = { request_id: requestId, status: "ERROR", error: (e as Error).message };
      }
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    });
    return requestId;
  }

  const res = await fetch(`https://queue.fal.run/${model}?fal_webhook=${encodeURIComponent(hook)}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${env("FAL_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error(`fal.ai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  return json.request_id as string;
}
