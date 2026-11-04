"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BuyButton({ packageId, label }: { packageId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function buy() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/payments/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Hitilafu imetokea.");
      setBusy(false);
      return;
    }
    if (json.url) {
      window.location.href = json.url; // hosted payment page (M-Pesa, Tigo Pesa, Airtel Money, card...)
      return;
    }
    router.refresh(); // demo mode: credits added immediately
    setBusy(false);
  }

  return (
    <>
      <button onClick={buy} disabled={busy}>{busy ? "Subiri…" : label}</button>
      {error && <p className="error">{error}</p>}
    </>
  );
}
