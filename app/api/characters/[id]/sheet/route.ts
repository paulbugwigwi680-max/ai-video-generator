import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { COST, MODELS, STYLE_SUFFIX } from "@/lib/config";
import { spendCredits, refundCredits } from "@/lib/credits";
import { submitFal } from "@/lib/fal";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Ingia kwanza." }, { status: 401 });

  // RLS guarantees the character belongs to this user's project.
  const { data: c } = await supabase.from("characters").select("*").eq("id", id).single();
  if (!c) return NextResponse.json({ error: "Mhusika hajapatikana." }, { status: 404 });
  if (c.status === "processing") return NextResponse.json({ error: "Tayari inatengenezwa." }, { status: 409 });

  if (!(await spendCredits(user.id, COST.character))) {
    return NextResponse.json({ error: "Credits hazitoshi." }, { status: 402 });
  }

  try {
    const prompt = `Portrait photo of ${c.name}, ${c.age}. ${c.appearance}. Wearing ${c.clothing}. Neutral relaxed expression, looking at camera, plain light grey studio background, head and shoulders, ${STYLE_SUFFIX}`;
    const jobId = await submitFal(
      MODELS.text2img,
      { prompt, image_size: "portrait_4_3", num_images: 1, output_format: "jpeg" },
      "character",
      id
    );
    await adminClient().from("characters").update({ status: "processing", provider_job_id: jobId, error: null }).eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    await refundCredits(user.id, COST.character);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
