import { after } from "next/server";
import { appUrl } from "@/lib/config";

export type HookKind = "character" | "keyframe" | "video";

// Free sample video (CC0) used only in DEMO_MODE.
const DEMO_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

function hookUrl(kind: HookKind, id: string) {
  const hook = new URL(`${appUrl()}/api/webhooks/fal`);
  hook.searchParams.set("kind", kind);
  hook.searchParams.set("id", id);
  hook.searchParams.set("secret", process.env.WEBHOOK_SECRET ?? "");
  return hook.toString();
}

/**
 * Submits a job to the fal.ai queue and returns immediately with a request id.
 * fal calls our webhook when the job is done, so Vercel never waits for generation.
 *
 * With DEMO_MODE=true nothing is sent to fal.ai (no cost): after a few seconds we call
 * our own webhook with a sample image/video, so the whole flow can be tested for free.
 */
export async function submitFal(model: string, input: Record<string, unknown>, kind: HookKind, id: string) {
  const hook = hookUrl(kind, id);

  if (process.env.DEMO_MODE === "true") {
    const requestId = `demo-${crypto.randomUUID()}`;
    after(async () => {
      await new Promise((r) => setTimeout(r, 4000));
      const size = kind === "character" ? "720/960" : "1280/720";
      const payload =
        kind === "video"
          ? { video: { url: DEMO_VIDEO } }
          : { images: [{ url: `https://picsum.photos/seed/${id}-${Date.now()}/${size}` }] };
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
