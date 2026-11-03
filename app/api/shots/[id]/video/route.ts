import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { MODELS, NEGATIVE_PROMPT, videoCost } from "@/lib/config";
import { spendCredits, refundCredits } from "@/lib/credits";
import { submitFal } from "@/lib/fal";
import { signedUrl } from "@/lib/storage";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Ingia kwanza." }, { status: 401 });

  const { data: shot } = await supabase.from("shots").select("*").eq("id", id).single();
  if (!shot) return NextResponse.json({ error: "Shot haijapatikana." }, { status: 404 });
  if (!shot.keyframe_url) return NextResponse.json({ error: "Tengeneza picha ya mwanzo kwanza." }, { status: 400 });
  if (shot.status === "processing") return NextResponse.json({ error: "Tayari inatengenezwa." }, { status: 409 });

  const cost = videoCost(shot.duration_seconds);
  if (!(await spendCredits(user.id, cost))) {
    return NextResponse.json({ error: "Credits hazitoshi." }, { status: 402 });
  }

  try {
    const imageUrl = await signedUrl("keyframes", shot.keyframe_url);
    if (!imageUrl) throw new Error("Picha ya mwanzo haipatikani.");

    const jobId = await submitFal(
      MODELS.video,
      {
        prompt: `${shot.prompt}. Natural, subtle motion. The people keep exactly the same faces and appearance throughout.`,
        image_url: imageUrl,
        duration: String(shot.duration_seconds >= 8 ? 10 : 5),
        negative_prompt: NEGATIVE_PROMPT,
        cfg_scale: 0.5,
      },
      "video",
      id
    );
    await adminClient().from("shots").update({ status: "processing", provider_job_id: jobId, error: null }).eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    await refundCredits(user.id, cost);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
