"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const supabase = createClient();
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError("Barua pepe au nenosiri si sahihi.");
      else {
        router.push("/dashboard");
        router.refresh();
      }
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else setInfo("Tumekutumia barua pepe ya kuthibitisha akaunti. Bonyeza kiungo ndani yake, kisha ingia.");
    }
    setBusy(false);
  }

  return (
    <main className="login">
      <h1>{mode === "in" ? "Ingia" : "Fungua akaunti"}</h1>
      <p className="muted">Tengeneza video za AI zenye wahusika wasiobadilika.</p>
      <form onSubmit={submit}>
        <label htmlFor="email">Barua pepe</label>
        <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="pw">Nenosiri</label>
        <input id="pw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        <div style={{ marginTop: 18 }} className="row">
          <button type="submit" disabled={busy}>{mode === "in" ? "Ingia" : "Fungua akaunti"}</button>
          <button type="button" className="ghost" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "Sina akaunti" : "Nina akaunti"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {info && <p>{info}</p>}
      </form>
    </main>
  );
}
