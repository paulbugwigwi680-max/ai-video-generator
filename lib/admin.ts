// Admin = an email listed in ADMIN_EMAILS (comma separated), set in Vercel. Server only.
const admins = () =>
  (process.env.ADMIN_EMAILS ?? process.env.admin_emails ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function isAdminEmail(email: string | null | undefined) {
  return !!email && admins().includes(email.toLowerCase());
}
