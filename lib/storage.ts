import { adminClient } from "@/lib/supabase/admin";

// Database columns named *_url hold STORAGE PATHS (e.g. "<user>/<project>/<shot>.mp4").
// Buckets are private, so we sign short-lived URLs whenever we need to display or send a file.

export async function signedUrl(bucket: string, path: string | null | undefined, seconds = 3600) {
  if (!path) return null;
  const { data } = await adminClient().storage.from(bucket).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

// Stores a file in Supabase Storage from either a normal URL or a base64 data: URL.
// Normal URLs are tried twice with a timeout, because remote services can be slow.
export async function storeFromUrl(bucket: string, path: string, sourceUrl: string) {
  if (sourceUrl.startsWith("data:")) {
    const match = sourceUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) throw new Error("Invalid data URL");
    const bytes = Buffer.from(match[3], match[2] ? "base64" : "utf8");
    if (bytes.length < 1000) throw new Error("Generated file is empty");
    const { error } = await adminClient()
      .storage.from(bucket)
      .upload(path, bytes, { contentType: match[1] ?? "image/jpeg", upsert: true });
    if (error) throw error;
    return path;
  }

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
