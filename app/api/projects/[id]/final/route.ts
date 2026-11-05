import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

// Saves the shareable Cloudinary link of the finished documentary on the project.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Ingia kwanza." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const url = body?.url;
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloud || typeof url !== "string" || !url.startsWith(`https://res.cloudinary.com/${cloud}/`)) {
    return NextResponse.json({ error: "Link si sahihi." }, { status: 400 });
  }

  // Row Level Security makes sure the project belongs to this user.
  const { data, error } = await supabase
    .from("projects")
    .update({ final_video_url: url, status: "completed" })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) {
    return NextResponse.json({ error: "Mradi haujapatikana." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
