import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// The user uploads their own photo for a character (replaces the AI portrait).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Ingia kwanza." }, { status: 401 });

  // Row Level Security guarantees the character belongs to this user's project.
  const { data: c } = await supabase.from("characters").select("id,project_id").eq("id", id).single();
  if (!c) return NextResponse.json({ error: "Mhusika hajapatikana." }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Chagua faili la picha." }, { status: 400 });
  }
  if (file.size > 4_000_000) {
    return NextResponse.json({ error: "Picha ni kubwa mno. Jaribu picha ndogo zaidi." }, { status: 413 });
  }

  const db = adminClient();
  const path = `${user.id}/${c.project_id}/${id}-${Date.now()}.jpg`;
  const { error: upErr } = await db.storage
    .from("character-refs")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: "Imeshindwa kuhifadhi picha." }, { status: 500 });

  await db
    .from("characters")
    .update({ reference_urls: [path], status: "completed", user_photo: true, error: null })
    .eq("id", id);
  return NextResponse.json({ ok: true });
}
