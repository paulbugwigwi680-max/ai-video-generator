"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Pkg = { id: string; name: string; credits: number; amount: number };

export default function ManualPay({ packages, note, currency }: { packages: Pkg[]; note: string; currency: string }) {
  const router = useRouter();
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    setOk(false);
    const res = await fetch("/api/payments/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId, reference }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(json.error ?? "Hitilafu imetokea.");
      return;
    }
    setOk(true);
    setReference("");
    setMsg("Ombi limetumwa. Tutakagua malipo yako na credits zitaingia hivi karibuni.");
    router.refresh();
  }

  return (
    <form className="manual" onSubmit={submit}>
      <h2>Lipa kwa simu</h2>
      <pre>{note}</pre>

      <label htmlFor="mp-pkg">Kifurushi ulicholipia</label>
      <select id="mp-pkg" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
        {packages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}: {p.credits} credits ({currency} {p.amount.toLocaleString("en-US")})
          </option>
        ))}
      </select>

      <label htmlFor="mp-ref">Namba ya muamala (kutoka kwenye ujumbe wa malipo)</label>
      <input id="mp-ref" value={reference} onChange={(e) => setReference(e.target.value)} required placeholder="mfano: CK12AB34CD" />

      <button type="submit" className="full" disabled={busy}>{busy ? "Subiri…" : "Nimelipa, tuma ombi"}</button>
      {msg && <p className={ok ? "info" : "error"}>{msg}</p>}
    </form>
  );
}
