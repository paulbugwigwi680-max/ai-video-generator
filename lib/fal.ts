import { appUrl } from "@/lib/config";

export type HookKind = "character" | "keyframe" | "video";

/**
 * Submits a job to the fal.ai queue and returns immediately with a request id.
 * fal calls our webhook when the job is done, so Vercel never waits for generation.
 */
export async function submitFal(model: string, input: Record<string, unknown>, kind: HookKind, id: string) {
  const hook = new URL(`${appUrl()}/api/webhooks/fal`);
  hook.searchParams.set("kind", kind);
  hook.searchParams.set("id", id);
  hook.searchParams.set("secret", process.env.WEBHOOK_SECRET ?? "");

  const res = await fetch(`https://queue.fal.run/${model}?fal_webhook=${encodeURIComponent(hook.toString())}`, {
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
