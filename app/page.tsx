import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Logo from "@/components/Logo";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="land">
      <header className="land-nav">
        <Logo size={40} />
        <Link href="/login" className="btn-big ghost">Ingia</Link>
      </header>

      <section className="land-hero">
        <div>
          <h1>
            Documentary za AI zenye watu <em>wanaobaki wale wale.</em>
          </h1>
          <p className="land-lead">
            Andika mada kwa Kiswahili. BUGWIGWI inaandaa script, wahusika, picha na video, kisha inakuonyesha documentary
            nzima ikiwa na simulizi na manukuu.
          </p>
          <div className="cta-row">
            <Link href="/login" className="btn-big">Anza sasa</Link>
            <a href="#jinsi" className="btn-big ghost">Jinsi inavyofanya kazi</a>
          </div>
        </div>
        <div className="strip" aria-hidden="true">
          <div className="fr"><span className="cap">Onyesho 1 · Alfajiri pwani</span></div>
          <div className="fr"><span className="cap">Onyesho 2 · Mzee na mwalimu</span></div>
          <div className="fr"><span className="cap">Onyesho 3 · Miche inapandwa</span></div>
        </div>
      </section>

      <section className="land-sec" id="jinsi">
        <h2>Kutoka wazo hadi documentary katika hatua nne</h2>
        <ol className="steps">
          <li><b>1. Andika mada</b>Eleza unachotaka, aina ya video na urefu. Lugha ni Kiswahili au Kiingereza.</li>
          <li><b>2. Script na wahusika</b>AI inaandika hadithi, onyesho kwa onyesho, na kuwapa wahusika sura za kipekee.</li>
          <li><b>3. Picha na video</b>Kila shot inatengenezwa ikitumia sura ileile ya mhusika, ili asibadilike.</li>
          <li><b>4. Cheza na pakua</b>Tazama documentary nzima, sikiliza simulizi, kisha pakua video yako.</li>
        </ol>
      </section>

      <section className="land-band">
        <div className="land-sec">
          <h2>Kwa nini wahusika hawabadiliki?</h2>
          <p>
            Video nyingi za AI zinabadilisha sura ya mtu kila klipu. BUGWIGWI inaandika maelezo ya kila mhusika mara moja,
            inatengeneza picha yake ya rejea, kisha inaitumia kwenye kila shot. Wahusika wote pia wanatofautiana kwa makusudi:
            umri, umbo, nywele na mavazi.
          </p>
        </div>
      </section>

      <section className="land-sec">
        <h2>Lipa kwa unachotumia</h2>
        <p className="muted" style={{ maxWidth: "60ch" }}>
          Hakuna usajili wa kila mwezi. Unanunua credits na kuzitumia kwenye script, wahusika, picha na video. Unaona
          kinachogharimu kiasi gani kabla ya kuanza.
        </p>
        <p style={{ marginTop: 24 }}>
          <Link href="/login" className="btn-big">Fungua akaunti</Link>
        </p>
      </section>

      <footer className="land-foot">© {new Date().getFullYear()} BUGWIGWI · AI Video Studio</footer>
    </div>
  );
}
