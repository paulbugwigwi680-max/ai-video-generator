"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/Logo";
import PasswordInput from "@/components/PasswordInput";

export default function ResetPassword() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        setHasSession(!!data.user);
        setReady(true);
      });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Manenosiri hayafanani.");
      return;
    }
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="login">
      <Logo stacked size={64} />
      <h1>Weka nenosiri jipya</h1>

      {!ready ? (
        <p className="muted">Inapakia…</p>
      ) : !hasSession ? (
        <>
          <p className="error">Kiungo hiki kimeisha muda au si sahihi.</p>
          <p>
            <a href="/login">Rudi kwenye ukurasa wa kuingia</a> na uombe kiungo kipya.
          </p>
        </>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="pw">Nenosiri jipya</label>
          <PasswordInput id="pw" value={password} onChange={setPassword} minLength={8} autoComplete="new-password" />
          <label htmlFor="pw2">Rudia nenosiri</label>
          <PasswordInput id="pw2" value={confirm} onChange={setConfirm} minLength={8} autoComplete="new-password" />
          <button type="submit" className="full" disabled={busy}>
            {busy ? "Inahifadhi…" : "Hifadhi nenosiri"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </main>
  );
}
