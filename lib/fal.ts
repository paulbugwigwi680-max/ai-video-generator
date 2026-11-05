import { after } from "next/server";
import { appUrl } from "@/lib/config";

export type HookKind = "character" | "keyframe" | "video";

// Accept both UPPERCASE and lowercase variable names.
const env = (name: string) => process.env[name] ?? process.env[name.toLowerCase()];

function hookUrl(kind: HookKind, id: string) {
  const hook = new URL(`${appUrl()}/api/webhooks/fal`);
  hook.searchParams.set("kind", kind);
  hook.searchParams.set("id", id);
  hook.searchParams.set("secret", process.env.WEBHOOK_SECRET ?? "");
  return hook.toString();
}

// Free image generation with Cloudflare Workers AI (FLUX.1 schnell). Used only in DEMO_MODE.
// Returns a data: URL; the webhook stores it in Supabase Storage.
async function cloudflareImage(prompt: string): Promise<string> {
  const account = env("CLOUDFLARE_ACCOUNT_ID");
  const token = env("CLOUDFLARE_API_TOKEN");
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 4 }),
      signal: AbortSignal.timeout(50000),
    }
  );
  const json = await res.json().catch(() => ({}));
  const b64: string | undefined = json?.result?.image;
  if (!res.ok || !b64) {
    const detail = json?.errors?.[0]?.message ?? `status ${res.status}`;
    throw new Error(`Cloudflare AI: ${detail}`);
  }
  return `data:image/jpeg;base64,${b64}`;
}

/**
 * Submits a job to the fal.ai queue and returns immediately with a request id.
 * fal calls our webhook when the job is done, so Vercel never waits for generation.
 *
 * DEMO_MODE=true: nothing is sent to fal.ai. Pictures are generated for free with
 * Cloudflare Workers AI using the real prompts, and the "video" step is skipped
 * (the player animates the pictures instead).
 */
export async function submitFal(model: string, input: Record<string, unknown>, kind: HookKind, id: string) {
  const hook = hookUrl(kind, id);

  if (env("DEMO_MODE") === "true") {
    if (kind !== "video" && !(env("CLOUDFLARE_ACCOUNT_ID") && env("CLOUDFLARE_API_TOKEN"))) {
      throw new Error("Weka CLOUDFLARE_ACCOUNT_ID na CLOUDFLARE_API_TOKEN kwenye Vercel (picha za bure).");
    }
    const requestId = `demo-${crypto.randomUUID()}`;
    const prompt = String(input.prompt ?? "");
    after(async () => {
      let body: Record<string, unknown>;
      try {
        const payload = kind === "video" ? { skip: true } : { images: [{ url: await cloudflareImage(prompt) }] };
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
