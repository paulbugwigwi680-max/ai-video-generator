import { after } from "next/server";
import { appUrl } from "@/lib/config";

export type HookKind = "character" | "keyframe" | "video";

function hookUrl(kind: HookKind, id: string) {
  const hook = new URL(`${appUrl()}/api/webhooks/fal`);
  hook.searchParams.set("kind", kind);
  hook.searchParams.set("id", id);
  hook.searchParams.set("secret", process.env.WEBHOOK_SECRET ?? "");
  return hook.toString();
}

// Free text-to-image service (no API key). Used only in DEMO_MODE so that
// the pictures match the prompts at zero cost.
function freeImage(prompt: string, width: number, height: number) {
  const seed = Math.floor(Math.random() * 1_000_000);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=${width}&height=${height}&model=flux&nologo=true&seed=${seed}`;
}

/**
 * Submits a job to the fal.ai queue and returns immediately with a request id.
 * fal calls our webhook when the job is done, so Vercel never waits for generation.
 *
 * DEMO_MODE=true: nothing is sent to fal.ai. Pictures come from a free generator using the
 * real prompts, and the "video" step is skipped (the player animates the pictures instead).
 */
export async function submitFal(model: string, input: Record<string, unknown>, kind: HookKind, id: string) {
  const hook = hookUrl(kind, id);

  if (process.env.DEMO_MODE === "true") {
    const requestId = `demo-${crypto.randomUUID()}`;
    const prompt = String(input.prompt ?? "");
    after(async () => {
      const portrait = kind === "character";
      const payload =
        kind === "video"
          ? { skip: true }
          : { images: [{ url: freeImage(prompt, portrait ? 768 : 1280, portrait ? 1024 : 720) }] };
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId, status: "OK", payload }),
      }).catch(() => {});
    });
    return requestId;
  }

  const res = await fetch(`https://queue.fal.run/${model}?fal_webhook=${encodeURIComponent(hook)}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
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
