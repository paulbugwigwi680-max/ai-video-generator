import { adminClient } from "@/lib/supabase/admin";

export async function spendCredits(userId: string, amount: number) {
  const { data, error } = await adminClient().rpc("spend_credits", { p_user: userId, p_amount: amount });
  if (error) throw error;
  return data === true;
}

export async function addCredits(userId: string, amount: number) {
  await adminClient().rpc("refund_credits", { p_user: userId, p_amount: amount });
}

export const refundCredits = addCredits;
