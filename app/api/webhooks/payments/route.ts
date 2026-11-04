import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { addCredits } from "@/lib/credits";

export const maxDuration = 30;

// Flutterwave calls this after a payment. We never trust the webhook body alone:
// we verify the transaction with Flutterwave and credit the account exactly once.
export async function POST(req: Request) {
  const hash = process.env.FLW_WEBHOOK_HASH;
  const secret = process.env.FLW_SECRET_KEY;
  if (!hash || !secret || req.headers.get("verif-hash") !== hash) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const data = body?.data;
    if (!data?.id || !data?.tx_ref || data.status !== "successful") return NextResponse.json({ ok: true });

    const verify = await fetch(`https://api.flutterwave.com/v3/transactions/${data.id}/verify`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const vj = await verify.json();
    const d = vj?.data;
    if (vj?.status !== "success" || d?.status !== "successful" || d?.tx_ref !== data.tx_ref) {
      return NextResponse.json({ ok: true });
    }

    const db = adminClient();
    const { data: tx } = await db
      .from("transactions")
      .select("id,user_id,amount,currency,credits,status")
      .eq("id", d.tx_ref)
      .single();
    if (!tx || tx.status !== "pending") return NextResponse.json({ ok: true }); // unknown or already handled

    if (Number(d.amount) < Number(tx.amount) || d.currency !== tx.currency) {
      await db.from("transactions").update({ status: "failed" }).eq("id", tx.id);
      return NextResponse.json({ ok: true });
    }

    // Only the request that flips pending -> completed adds the credits.
    const { data: updated } = await db
      .from("transactions")
      .update({ status: "completed", provider_ref: String(d.id) })
      .eq("id", tx.id)
      .eq("status", "pending")
      .select("id");
    if (updated?.length) await addCredits(tx.user_id, tx.credits);
  } catch {
    // ignore malformed payloads
  }
  return NextResponse.json({ ok: true });
}
