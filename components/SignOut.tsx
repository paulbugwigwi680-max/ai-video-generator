"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOut() {
  const router = useRouter();
  return (
    <button
      className="ghost small"
      style={{ color: "#fff", borderColor: "#6b7a87" }}
      onClick={async () => {
        await createClient().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      Toka
    </button>
  );
}
