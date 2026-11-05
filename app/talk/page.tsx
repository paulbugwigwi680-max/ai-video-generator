import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Logo from "@/components/Logo";
import TalkPhoto from "@/components/TalkPhoto";

export const metadata = { title: "Picha ya kuongea" };

export default async function TalkPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <header className="topbar">
        <Link href="/dashboard">
          <Logo size={36} tone="light" tagline={false} />
        </Link>
        <Link href="/dashboard" className="credits">Miradi yangu</Link>
      </header>
      <main className="wrap">
        <h1>Picha ya kuongea au wimbo wa maneno</h1>
        <p className="muted" style={{ maxWidth: "68ch", margin: "8px 0 28px" }}>
          Pakia picha, andika maneno, chagua sauti ya kike au ya kiume, na picha itasoma maneno yako. Bonyeza kwenye mdomo
          wa picha ili usogee na sauti. Video unayopakua ina sauti.
        </p>
        <TalkPhoto />
      </main>
    </>
  );
}
