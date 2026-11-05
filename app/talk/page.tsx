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
          Pakia picha, andika maneno, na picha itasoma maneno yako kwa sauti ya kifaa chako. Hii inasogeza picha na kuonyesha
          maneno kama karaoke; si lip-sync halisi wala kuimba halisi, ambavyo vinahitaji huduma ya AI ya kulipia.
        </p>
        <TalkPhoto />
      </main>
    </>
  );
}
