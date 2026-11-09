"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const Icon = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const TABS = [
  { href: "/dashboard", label: "Miradi", d: "M4 5h16v14H4z M4 9h16 M9 5v14" },
  { href: "/talk", label: "Picha", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0" },
  { href: "/credits", label: "Credits", d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v10 M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" },
];

const SHOW_ON = ["/dashboard", "/project", "/talk", "/credits", "/admin"];

// App-style menu at the bottom of the screen (phones only).
export default function BottomNav() {
  const path = usePathname() ?? "";
  if (!SHOW_ON.some((p) => path === p || path.startsWith(p + "/"))) return null;

  return (
    <>
      <div className="bottomnav-space" />
      <nav className="bottomnav" aria-label="Menyu kuu">
        {TABS.map((t) => {
          const on = path === t.href || (t.href === "/dashboard" && path.startsWith("/project"));
          return (
            <Link key={t.href} href={t.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
              <Icon d={t.d} />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
