import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";
import { addCredits } from "@/lib/credits";
import { appUrl } from "@/lib/config";
import { CURRENCY, PACKAGES } from "@/lib/packages";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { user } = await getUser();
  if (!user) return NextResponse.json({ error: "Ingia kwanza." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const pkg = PACKAGES.find((p) => p.id === body.packageId);
  if (!pkg) return NextResponse.json({ error: "Kifurushi hakipo." }, { status: 400 });

  const secret = process.env.FLW_SECRET_KEY;
  const db = adminClient();

  const { data: tx, error } = await db
    .from("transactions")
    .insert({
      user_id: user.id,
      amount: pkg.amount,
      currency: CURRENCY,
      credits: pkg.credits,
      provider: secret ? "flutterwave" : "demo",
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !tx) return NextResponse.json({ error: "Imeshindwa kuanzisha malipo." }, { status: 500 });

  // No payment provider configured: only allowed in DEMO_MODE (free test credits).
  if (!secret) {
    if (process.env.DEMO_MODE === "true") {
      await db.from("transactions").update({ status: "completed" }).eq("id", tx.id);
      await addCredits(user.id, pkg.credits);
      return NextResponse.json({ demo: true });
    }
    await db.from("transactions").update({ status: "failed" }).eq("id", tx.id);
    return NextResponse.json({ error: "Malipo bado hayajawashwa." }, { status: 503 });
  }

  const res = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tx_ref: tx.id,
      amount: pkg.amount,
      currency: CURRENCY,
      redirect_url: `${appUrl()}/credits?tx=${tx.id}`,
      payment_options: "mobilemoneytanzania,card",
      customer: { email: user.email },
      customizations: { title: "BUGWIGWI", description: `${pkg.credits} credits` },
    }),
  });
  const json = await res.json().catch(() => ({}));
  const link: string | undefined = json?.data?.link;
  if (!res.ok || !link) {
    await db.from("transactions").update({ status: "failed" }).eq("id", tx.id);
    return NextResponse.json({ error: "Mtoa huduma wa malipo amekataa ombi. Jaribu tena." }, { status: 502 });
  }
  return NextResponse.json({ url: link });
}
