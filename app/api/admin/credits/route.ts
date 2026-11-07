import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { adminClient } from "@/lib/supabase/admin";
import { addCredits } from "@/lib/credits";

// Admin only: add credits to any registered user.
export async function POST(req: Request) {
  const { user } = await getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Huna ruhusa." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  const amount = Math.floor(Number(body.amount));
  if (!userId || !Number.isFinite(amount) || amount < 1 || amount > 100000) {
    return NextResponse.json({ error: "Weka idadi sahihi (1 hadi 100000)." }, { status: 400 });
  }

  const db = adminClient();
  const { data: profile } = await db.from("profiles").select("id").eq("id", userId).single();
  if (!profile) return NextResponse.json({ error: "Mtumiaji hajapatikana." }, { status: 404 });

  await addCredits(profile.id, amount);
  await db.from("transactions").insert({
    user_id: profile.id,
    amount: 0,
    currency: "TZS",
    credits: amount,
    provider: "admin",
    provider_ref: String(body.note ?? "").slice(0, 120) || "admin",
    status: "completed",
  });
  return NextResponse.json({ ok: true });
}
