import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { CURRENCY, PACKAGES } from "@/lib/packages";

// A user says "I paid" and gives the mobile-money transaction number. The admin approves it later.
export async function POST(req: Request) {
  const { user } = await getUser();
  if (!user) return NextResponse.json({ error: "Ingia kwanza." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const pkg = PACKAGES.find((p) => p.id === body.packageId);
  if (!pkg) return NextResponse.json({ error: "Kifurushi hakipo." }, { status: 400 });

  const reference = String(body.reference ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{5,30}$/.test(reference)) {
    return NextResponse.json({ error: "Namba ya muamala si sahihi (herufi na tarakimu pekee)." }, { status: 400 });
  }

  const db = adminClient();

  const { count } = await db
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("provider", "manual")
    .eq("status", "pending");
  if ((count ?? 0) >= 3) {
    return NextResponse.json({ error: "Una maombi 3 yanayosubiri. Subiri yashughulikiwe kwanza." }, { status: 429 });
  }

  const { data: dup } = await db.from("transactions").select("id").eq("provider_ref", reference).limit(1);
  if (dup?.length) {
    return NextResponse.json({ error: "Namba hii ya muamala imeshatumika." }, { status: 409 });
  }

  const { error } = await db.from("transactions").insert({
    user_id: user.id,
    amount: pkg.amount,
    currency: CURRENCY,
    credits: pkg.credits,
    provider: "manual",
    provider_ref: reference,
    status: "pending",
  });
  if (error) return NextResponse.json({ error: "Imeshindwa kutuma ombi." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
