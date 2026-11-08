import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

// Adds a new character to a project (the photo is uploaded afterwards).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Ingia kwanza." }, { status: 401 });

  const { data: project } = await supabase.from("projects").select("id").eq("id", id).single();
  if (!project) return NextResponse.json({ error: "Mradi haujapatikana." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Andika jina la mhusika." }, { status: 400 });

  const { count } = await supabase
    .from("characters")
    .select("id", { count: "exact", head: true })
    .eq("project_id", id);
  if ((count ?? 0) >= 8) {
    return NextResponse.json({ error: "Mradi unaweza kuwa na wahusika 8 tu." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("characters")
    .insert({
      project_id: id,
      name,
      age: String(body.age ?? "").trim().slice(0, 40),
      appearance: String(body.appearance ?? "").trim().slice(0, 400),
      clothing: String(body.clothing ?? "").trim().slice(0, 200),
    })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: "Imeshindwa kuongeza mhusika." }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
