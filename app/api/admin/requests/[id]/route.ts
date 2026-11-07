import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { adminClient } from "@/lib/supabase/admin";
import { addCredits } from "@/lib/credits";

// Admin only: approve or reject a manual payment request.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Huna ruhusa." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const approve = body.action === "approve";
  if (!approve && body.action !== "reject") {
    return NextResponse.json({ error: "Kitendo si sahihi." }, { status: 400 });
  }

  const db = adminClient();
  const { data: tx } = await db
    .from("transactions")
    .select("id,user_id,credits,status,provider")
    .eq("id", id)
    .single();
  if (!tx || tx.provider !== "manual" || tx.status !== "pending") {
    return NextResponse.json({ error: "Ombi halipo au limeshashughulikiwa." }, { status: 404 });
  }

  // Only the request that flips pending -> completed/failed counts, so credits are never added twice.
  const { data: updated } = await db
    .from("transactions")
    .update({ status: approve ? "completed" : "failed" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (approve && updated?.length) await addCredits(tx.user_id, tx.credits);

  return NextResponse.json({ ok: true });
}
