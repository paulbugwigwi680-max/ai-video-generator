import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { COST, videoCost } from "@/lib/config";
import { refundCredits } from "@/lib/credits";
import { storeFromUrl } from "@/lib/storage";

export const maxDuration = 60;

// fal.ai calls this when a job finishes. kind + id identify what to update.
export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!process.env.WEBHOOK_SECRET || sp.get("secret") !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const kind = sp.get("kind");
  const id = sp.get("id");
  if (!id || !["character", "keyframe", "video"].includes(kind ?? "")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const payload = body.payload ?? {};
  const success = body.status === "OK" && !body.error;
  const skip = kind === "video" && payload.skip === true; // demo mode: no video file
  const mediaUrl: string | undefined = kind === "video" ? payload.video?.url : payload.images?.[0]?.url;
  const db = adminClient();

  const table = kind === "character" ? "characters" : "shots";
  const { data: row } = await db.from(table).select("*").eq("id", id).single();
  if (!row) return NextResponse.json({ ok: true }); // nothing to do
  if (row.status !== "processing") return NextResponse.json({ ok: true }); // duplicate delivery

  const { data: project } = await db.from("projects").select("user_id").eq("id", row.project_id).single();
  if (!project) return NextResponse.json({ ok: true });
  const userId = project.user_id as string;

  try {
    if (skip) {
      await db.from("shots").update({ status: "completed", error: null }).eq("id", id);
    } else {
      if (!success || !mediaUrl) throw new Error(typeof body.error === "string" ? body.error : "Generation failed");

      if (kind === "character") {
        const path = `${userId}/${row.project_id}/${id}-${Date.now()}.jpg`;
        await storeFromUrl("character-refs", path, mediaUrl);
        await db
          .from("characters")
          .update({ reference_urls: [path], status: "completed", user_photo: false, error: null })
          .eq("id", id);
      } else if (kind === "keyframe") {
        const path = `${userId}/${row.project_id}/${id}-${Date.now()}.jpg`;
        await storeFromUrl("keyframes", path, mediaUrl);
        await db.from("shots").update({ keyframe_url: path, status: "draft", error: null }).eq("id", id);
      } else {
        const path = `${userId}/${row.project_id}/${id}.mp4`;
        await storeFromUrl("videos", path, mediaUrl);
        await db.from("shots").update({ video_url: path, status: "completed", error: null }).eq("id", id);
      }
    }
  } catch (e) {
    const refund = kind === "character" ? COST.character : kind === "keyframe" ? COST.keyframe : videoCost(row.duration_seconds);
    await refundCredits(userId, refund);
    await db
      .from(table)
      .update({ status: "failed", error: (e as Error).message.slice(0, 300) })
      .eq("id", id);
  }
  return NextResponse.json({ ok: true });
}
