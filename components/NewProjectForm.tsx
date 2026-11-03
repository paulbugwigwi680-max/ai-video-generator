"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewProjectForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(f.entries())),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Hitilafu imetokea.");
      setBusy(false);
      return;
    }
    router.push(`/project/${json.id}`);
  }

  return (
    <form onSubmit={submit} className="panel">
      <h2>Mradi mpya</h2>
      <label htmlFor="title">Jina (hiari)</label>
      <input id="title" name="title" />
      <label htmlFor="topic">Mada</label>
      <textarea id="topic" name="topic" rows={5} required placeholder="Mfano: Documentary kuhusu wavuvi wa Kilwa na jinsi wanavyotumia ngalawa za jadi." />
      <label htmlFor="type">Aina</label>
      <select id="type" name="type" defaultValue="documentary">
        <option value="documentary">Documentary</option>
        <option value="ad">Tangazo</option>
        <option value="story">Hadithi</option>
        <option value="education">Elimu</option>
        <option value="other">Nyingine</option>
      </select>
      <label htmlFor="language">Lugha ya msimulizi</label>
      <select id="language" name="language" defaultValue="sw">
        <option value="sw">Kiswahili</option>
        <option value="en">English</option>
      </select>
      <label htmlFor="length">Urefu</label>
      <select id="length" name="length" defaultValue="short">
        <option value="short">Fupi (shots 8)</option>
        <option value="medium">Wastani (shots 18)</option>
      </select>
      <label htmlFor="style">Mtindo wa picha (hiari)</label>
      <input id="style" name="style" placeholder="Mfano: kama filamu ya kihistoria, rangi za joto" />
      <div style={{ marginTop: 20 }}>
        <button type="submit" disabled={busy}>{busy ? "Inaandaa script…" : "Andaa mradi (credit 1)"}</button>
      </div>
      {busy && <p className="muted">Hii inaweza kuchukua hadi sekunde 60.</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
