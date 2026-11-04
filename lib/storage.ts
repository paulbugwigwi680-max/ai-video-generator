import { adminClient } from "@/lib/supabase/admin";

// Database columns named *_url hold STORAGE PATHS (e.g. "<user>/<project>/<shot>.mp4").
// Buckets are private, so we sign short-lived URLs whenever we need to display or send a file.

export async function signedUrl(bucket: string, path: string | null | undefined, seconds = 3600) {
  if (!path) return null;
  const { data } = await adminClient().storage.from(bucket).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

// Downloads a remote file and stores it in Supabase Storage.
// Tries twice with a timeout, because free image services can be slow or rate-limited.
export async function storeFromUrl(bucket: string, path: string, sourceUrl: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 1000) throw new Error("Downloaded file is empty");
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      const { error } = await adminClient().storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
      if (error) throw error;
      return path;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Download failed");
}
