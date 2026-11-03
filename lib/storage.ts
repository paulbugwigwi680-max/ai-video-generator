import { adminClient } from "@/lib/supabase/admin";

// Database columns named *_url hold STORAGE PATHS (e.g. "<user>/<project>/<shot>.mp4").
// Buckets are private, so we sign short-lived URLs whenever we need to display or send a file.

export async function signedUrl(bucket: string, path: string | null | undefined, seconds = 3600) {
  if (!path) return null;
  const { data } = await adminClient().storage.from(bucket).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

export async function storeFromUrl(bucket: string, path: string, sourceUrl: string) {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const { error } = await adminClient().storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
  return path;
}
