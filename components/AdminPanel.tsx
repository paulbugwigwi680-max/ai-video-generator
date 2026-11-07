"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AdminUser = { id: string; email: string; credits: number; projects: number };
export type AdminRequest = {
  id: string;
  email: string;
  credits: number;
  amount: number;
  currency: string;
  reference: string;
  created: string;
};

export default function AdminPanel({ users, requests }: { users: AdminUser[]; requests: AdminRequest[] }) {
  const router = useRouter();
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [amount, setAmount] = useState(100);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function post(url: string, body: object) {
    setBusy(true);
    setMsg("");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(json.error ?? "Hitilafu imetokea.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    if (await post("/api/admin/credits", { userId, amount, note })) setMsg("Credits zimeongezwa.");
  }

  return (
    <>
      <h2>Ongeza credits</h2>
      <form className="grant" onSubmit={grant}>
        <div>
          <label htmlFor="g-user">Mtumiaji</label>
          <select id="g-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.email} ({u.credits})</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="g-amount">Idadi</label>
          <input id="g-amount" type="number" min={1} max={100000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </div>
        <div>
          <label htmlFor="g-note">Maelezo (hiari)</label>
          <input id="g-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mfano: zawadi" />
        </div>
        <button type="submit" disabled={busy || !userId}>Ongeza</button>
      </form>
      <div className="quick">
        {[50, 100, 200, 500].map((n) => (
          <button key={n} type="button" className="ghost small" onClick={() => setAmount(n)}>{n}</button>
        ))}
      </div>
      {msg && <p className="info">{msg}</p>}

      <h2>Maombi ya malipo yanayosubiri ({requests.length})</h2>
      {requests.length ? (
        <table className="tx">
          <thead>
            <tr><th>Tarehe</th><th>Mtumiaji</th><th>Credits</th><th>Kiasi</th><th>Namba ya muamala</th><th></th></tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>{r.created}</td>
                <td>{r.email}</td>
                <td>{r.credits}</td>
                <td>{r.currency} {r.amount.toLocaleString("en-US")}</td>
                <td><code>{r.reference}</code></td>
                <td>
                  <div className="row">
                    <button className="small" disabled={busy} onClick={() => post(`/api/admin/requests/${r.id}`, { action: "approve" })}>Kubali</button>
                    <button className="ghost small" disabled={busy} onClick={() => post(`/api/admin/requests/${r.id}`, { action: "reject" })}>Kataa</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Hakuna maombi yanayosubiri.</p>
      )}
    </>
  );
}
