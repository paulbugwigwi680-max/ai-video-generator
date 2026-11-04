"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Logo from "@/components/Logo";
import PasswordInput from "@/components/PasswordInput";

type Mode = "in" | "up" | "forgot";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "link") {
      setError("Kiungo kimeisha muda au si sahihi. Omba kiungo kipya.");
    }
  }, []);

  function switchMode(m: Mode) {
    setMode(m);
    setError("");
    setInfo("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const supabase = createClient();
    const origin = window.location.origin;

    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError("Barua pepe au nenosiri si sahihi.");
      else {
        router.push("/dashboard");
        router.refresh();
      }
    } else if (mode === "up") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${origin}/auth/callback?next=/dashboard` },
      });
      if (error) setError(error.message);
      else if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else setInfo("Tumekutumia barua pepe ya kuthibitisha akaunti. Bonyeza kiungo ndani yake, kisha ingia.");
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/auth/callback?next=/reset-password`,
      });
      if (error) setError(error.message);
      else setInfo("Kama barua pepe hii ina akaunti, tumetuma kiungo cha kuweka nenosiri jipya. Angalia pia folda ya spam.");
    }
    setBusy(false);
  }

  const title = mode === "in" ? "Karibu tena" : mode === "up" ? "Fungua akaunti" : "Umesahau nenosiri?";
  const subtitle =
    mode === "forgot"
      ? "Andika barua pepe yako, tutakutumia kiungo cha kuweka nenosiri jipya."
      : mode === "up"
        ? "Jisajili kutengeneza documentary yako ya kwanza."
        : "Ingia uendelee na miradi yako.";
  const action = mode === "in" ? "Ingia" : mode === "up" ? "Fungua akaunti" : "Tuma kiungo";

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <Logo stacked size={64} />
        </div>

        <h1>{title}</h1>
        <p className="auth-sub">{subtitle}</p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Barua pepe</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="jina@mfano.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {mode !== "forgot" && (
            <div className="field">
              <label htmlFor="pw">Nenosiri</label>
              <PasswordInput
                id="pw"
                value={password}
                onChange={setPassword}
                minLength={8}
                autoComplete={mode === "in" ? "current-password" : "new-password"}
              />
            </div>
          )}

          {mode === "in" && (
            <div className="forgot-row">
              <button type="button" className="linklike" onClick={() => switchMode("forgot")}>
                Umesahau nenosiri?
              </button>
            </div>
          )}

          <button type="submit" className="full" disabled={busy}>
            {busy ? "Subiri…" : action}
          </button>

          {error && <p className="error" role="alert">{error}</p>}
          {info && <p className="info" role="status">{info}</p>}
        </form>

        <div className="auth-switch">
          {mode === "in" && (
            <>
              Huna akaunti?{" "}
              <button type="button" className="linklike" onClick={() => switchMode("up")}>
                Fungua akaunti
              </button>
            </>
          )}
          {mode === "up" && (
            <>
              Tayari una akaunti?{" "}
              <button type="button" className="linklike" onClick={() => switchMode("in")}>
                Ingia
              </button>
            </>
          )}
          {mode === "forgot" && (
            <button type="button" className="linklike" onClick={() => switchMode("in")}>
              Rudi kuingia
            </button>
          )}
        </div>
      </div>

      <Link href="/" className="auth-back">← Rudi mwanzo</Link>
    </main>
  );
}
