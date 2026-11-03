import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NewProjectForm from "@/components/NewProjectForm";
import SignOut from "@/components/SignOut";

const STATUS: Record<string, string> = {
  draft: "Inaandaliwa",
  queued: "Kwenye foleni",
  processing: "Inatengenezwa",
  completed: "Tayari",
  failed: "Imeshindikana",
};

export default async function Dashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: projects }] = await Promise.all([
    supabase.from("profiles").select("credits").eq("id", user.id).single(),
    supabase.from("projects").select("id,title,type,status,created_at").order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <header className="topbar">
        <span className="brand">AI Video Generator</span>
        <span className="row">
          <span className="credits">Credits: <b>{profile?.credits ?? 0}</b></span>
          <SignOut />
        </span>
      </header>
      <main className="wrap dash">
        <section>
          <h2>Miradi yako</h2>
          {projects?.length ? (
            <ul className="projects">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/project/${p.id}`}>
                    <span className="t">{p.title}</span>
                    <span className="muted">{STATUS[p.status] ?? p.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Bado huna mradi. Andika mada upande wa pili ili kuanza.</p>
          )}
        </section>
        <NewProjectForm />
      </main>
    </>
  );
}
