import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Logo from "@/components/Logo";
import BuyButton from "@/components/BuyButton";
import { CURRENCY, PACKAGES } from "@/lib/packages";

const STATUS: Record<string, string> = {
  pending: "Inasubiri",
  completed: "Imekamilika",
  failed: "Imeshindikana",
};

export default async function CreditsPage({ searchParams }: { searchParams: Promise<{ tx?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: txs }] = await Promise.all([
    supabase.from("profiles").select("credits").eq("id", user.id).single(),
    supabase
      .from("transactions")
      .select("id,credits,amount,currency,status,created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <>
      <header className="topbar">
        <Link href="/dashboard">
          <Logo size={36} tone="light" tagline={false} />
        </Link>
        <span className="credits">Credits: <b>{profile?.credits ?? 0}</b></span>
      </header>
      <main className="wrap">
        <p className="muted"><Link href="/dashboard">Rudi kwenye miradi</Link></p>
        <h1>Nunua credits</h1>
        <p className="muted">
          Kila hatua inatumia credits: script 1, sura ya mhusika 2, picha 1, video ya sekunde 5 ni credits 5 (sekunde 10 ni 10).
        </p>

        {sp.tx && (
          <p className="info">
            Tunathibitisha malipo yako. Credits zitaonekana ndani ya dakika chache. Onyesha upya ukurasa huu usipoziona.
          </p>
        )}

        <div className="pkgs">
          {PACKAGES.map((p) => (
            <div className="pkg" key={p.id}>
              <h3>{p.name}</h3>
              <div className="big">{p.credits} credits</div>
              <div className="price">{CURRENCY} {p.amount.toLocaleString("en-US")}</div>
              <BuyButton packageId={p.id} label="Nunua" />
            </div>
          ))}
        </div>

        <h2>Malipo ya hivi karibuni</h2>
        {txs?.length ? (
          <table className="tx">
            <thead>
              <tr><th>Tarehe</th><th>Credits</th><th>Kiasi</th><th>Hali</th></tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.created_at).toLocaleDateString("en-GB")}</td>
                  <td>{t.credits}</td>
                  <td>{t.currency} {Number(t.amount).toLocaleString("en-US")}</td>
                  <td>{STATUS[t.status] ?? t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Bado hujafanya malipo yoyote.</p>
        )}
      </main>
    </>
  );
}
