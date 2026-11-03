import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { COST } from "@/lib/config";
import { spendCredits, refundCredits } from "@/lib/credits";
import { planProject } from "@/lib/pipeline/plan";

export const maxDuration = 60;

const LENGTHS: Record<string, { scenes: number; shotsPerScene: number }> = {
  short: { scenes: 4, shotsPerScene: 2 },
  medium: { scenes: 6, shotsPerScene: 3 },
};

export async function POST(req: Request) {
  const { user } = await getUser();
  if (!user) return NextResponse.json({ error: "Ingia kwanza." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const topic = String(body.topic ?? "").trim();
  if (topic.length < 10) {
    return NextResponse.json({ error: "Eleza mada kwa undani zaidi (angalau herufi 10)." }, { status: 400 });
  }
  const type = ["documentary", "ad", "story", "education", "other"].includes(body.type) ? body.type : "documentary";
  const language = body.language === "en" ? "en" : "sw";
  const style = String(body.style ?? "").slice(0, 200);
  const len = LENGTHS[body.length] ?? LENGTHS.short;

  if (!(await spendCredits(user.id, COST.script))) {
    return NextResponse.json({ error: "Credits hazitoshi." }, { status: 402 });
  }

  try {
    const plan = await planProject({ topic, type, language, style, ...len });
    const db = adminClient();

    const { data: project, error: pErr } = await db
      .from("projects")
      .insert({
        user_id: user.id,
        title: String(body.title ?? "").trim() || plan.title,
        type,
        topic,
        language,
        style,
      })
      .select("id")
      .single();
    if (pErr || !project) throw pErr ?? new Error("Project insert failed");

    const charRows = plan.characters.map((c) => ({
      project_id: project.id,
      name: c.name,
      age: c.age,
      appearance: c.appearance,
      clothing: c.clothing,
    }));
    const { data: chars } = charRows.length
      ? await db.from("characters").insert(charRows).select("id,name")
      : { data: [] as { id: string; name: string }[] };
    const charId = new Map((chars ?? []).map((c) => [c.name, c.id]));

    const locRows = plan.locations.map((l) => ({ project_id: project.id, name: l.name, description: l.description }));
    const { data: locs } = locRows.length
      ? await db.from("locations").insert(locRows).select("id,name")
      : { data: [] as { id: string; name: string }[] };
    const locId = new Map((locs ?? []).map((l) => [l.name, l.id]));

    for (let i = 0; i < plan.scenes.length; i++) {
      const s = plan.scenes[i];
      const { data: scene, error: sErr } = await db
        .from("scenes")
        .insert({ project_id: project.id, position: i + 1, summary: s.summary, narration: s.narration })
        .select("id")
        .single();
      if (sErr || !scene) throw sErr ?? new Error("Scene insert failed");

      const shotRows = s.shots.map((sh, j) => ({
        scene_id: scene.id,
        project_id: project.id,
        position: j + 1,
        prompt: sh.prompt,
        character_ids: sh.characters.map((n) => charId.get(n)).filter(Boolean),
        location_id: sh.location ? locId.get(sh.location) ?? null : null,
        duration_seconds: sh.duration_seconds >= 8 ? 10 : 5,
      }));
      const { error: shErr } = await db.from("shots").insert(shotRows);
      if (shErr) throw shErr;
    }

    return NextResponse.json({ id: project.id });
  } catch (e) {
    await refundCredits(user.id, COST.script);
    return NextResponse.json({ error: `Imeshindwa kuandaa script: ${(e as Error).message}` }, { status: 500 });
  }
}
