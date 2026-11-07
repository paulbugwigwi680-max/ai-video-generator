import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import Logo from "@/components/Logo";
import AdminPanel, { type AdminRequest, type AdminUser } from "@/components/AdminPanel";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  const db = adminClient();
  const [{ data: profiles }, { data: pending }, { data: projects }] = await Promise.all([
    db.from("profiles").select("id,email,credits,created_at").order("created_at", { ascending: false }),
    db
      .from("transactions")
      .select("id,user_id,credits,amount,currency,provider_ref,created_at")
      .eq("provider", "manual")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    db.from("projects").select("user_id"),
  ]);

  const projectCount = new Map<string, number>();
  for (const p of projects ?? []) projectCount.set(p.user_id, (projectCount.get(p.user_id) ?? 0) + 1);

  const users: AdminUser[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email ?? "(bila barua pepe)",
    credits: p.credits,
    projects: projectCount.get(p.id) ?? 0,
  }));
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  const requests: AdminRequest[] = (pending ?? []).map((t) => ({
    id: t.id,
    email: emailById.get(t.user_id) ?? "?",
    credits: t.credits,
    amount: Number(t.amount),
    currency: t.currency ?? "TZS",
    reference: t.provider_ref ?? "",
    created: new Date(t.created_at).toLocaleString("en-GB"),
  }));

  const totalCredits = users.reduce((a, u) => a + u.credits, 0);

  return (
    <>
      <header className="topbar">
        <Link href="/dashboard">
          <Logo size={36} tone="light" tagline={false} />
        </Link>
        <Link href="/dashboard" className="credits">Rudi kwenye miradi</Link>
      </header>
      <main className="wrap admin">
        <h1>Admin</h1>
        <div className="stat">
          <div><b>{users.length}</b><span className="muted">watumiaji</span></div>
          <div><b>{totalCredits}</b><span className="muted">credits zote zilizobaki</span></div>
          <div><b>{requests.length}</b><span className="muted">maombi yanayosubiri</span></div>
        </div>

        <AdminPanel users={users} requests={requests} />

        <h2>Watumiaji wote</h2>
        <table className="tx">
          <thead>
            <tr><th>Barua pepe</th><th>Credits</th><th>Miradi</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.credits}</td>
                <td>{u.projects}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
