import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { COST, MODELS, STYLE_SUFFIX } from "@/lib/config";
import { spendCredits, refundCredits } from "@/lib/credits";
import { submitFal } from "@/lib/fal";
import { signedUrl } from "@/lib/storage";

export const maxDuration = 60;

type CharRow = {
  name: string;
  age: string;
  appearance: string;
  clothing: string;
  reference_urls: string[] | null;
};

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Ingia kwanza." }, { status: 401 });

  const { data: shot } = await supabase.from("shots").select("*").eq("id", id).single();
  if (!shot) return NextResponse.json({ error: "Shot haijapatikana." }, { status: 404 });
  if (shot.status === "processing") return NextResponse.json({ error: "Tayari inatengenezwa." }, { status: 409 });

  const demo = process.env.DEMO_MODE === "true";

  // Characters appearing in this shot, with their reference portraits.
  const { data } = shot.character_ids.length
    ? await supabase.from("characters").select("name,age,appearance,clothing,reference_urls").in("id", shot.character_ids)
    : { data: [] as CharRow[] };
  const chars = (data ?? []) as CharRow[];
  const withRef = chars.filter((c) => c.reference_urls && c.reference_urls.length > 0);

  if (!demo && chars.length > withRef.length) {
    return NextResponse.json({ error: "Tengeneza sura za wahusika wa shot hii kwanza." }, { status: 400 });
  }

  if (!(await spendCredits(user.id, COST.keyframe))) {
    return NextResponse.json({ error: "Credits hazitoshi." }, { status: 402 });
  }

  try {
    let model = MODELS.text2img;
    let input: Record<string, unknown>;

    if (!demo && withRef.length) {
      const urls = (
        await Promise.all(withRef.map((c) => signedUrl("character-refs", c.reference_urls![0])))
      ).filter(Boolean) as string[];
      const roster = withRef.map((c, i) => `Reference image ${i + 1} is ${c.name} (${c.age}).`).join(" ");
      model = MODELS.keyframeRef;
      input = {
        prompt: `${roster} Keep every person's face, hair, age, skin tone and build exactly identical to their reference image. Scene: ${shot.prompt}. ${STYLE_SUFFIX}`,
        image_urls: urls,
        aspect_ratio: "16:9",
        output_format: "jpeg",
      };
    } else {
      // Text-only prompt. The fixed description of each character is repeated in every
      // shot, which keeps people looking as similar as a text model allows.
      const people = chars
        .map((c) => `${c.name}: ${c.age} years old, ${c.appearance}, wearing ${c.clothing}`)
        .join(". ");
      input = {
        prompt: `${shot.prompt}.${people ? ` People in the scene: ${people}.` : ""} ${STYLE_SUFFIX}`,
        image_size: "landscape_16_9",
        num_images: 1,
        output_format: "jpeg",
      };
    }

    const jobId = await submitFal(model, input, "keyframe", id);
    await adminClient().from("shots").update({ status: "processing", provider_job_id: jobId, error: null }).eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    await refundCredits(user.id, COST.keyframe);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
