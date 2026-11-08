import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

// Chooses which characters appear in a shot.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Ingia kwanza." }, { status: 401 });

  const { data: shot } = await supabase.from("shots").select("id,project_id").eq("id", id).single();
  if (!shot) return NextResponse.json({ error: "Shot haijapatikana." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const wanted: string[] = Array.isArray(body.characterIds) ? body.characterIds.map(String) : [];

  // Keep only characters that really belong to this project.
  const { data: valid } = await supabase.from("characters").select("id").eq("project_id", shot.project_id);
  const ok = new Set((valid ?? []).map((c) => c.id as string));
  const ids = wanted.filter((x) => ok.has(x));

  const { error } = await supabase.from("shots").update({ character_ids: ids }).eq("id", id);
  if (error) return NextResponse.json({ error: "Imeshindwa kuhifadhi." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
