import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/storage";
import Storyboard, { type CharacterView, type SceneView } from "@/components/Storyboard";
import Documentary, { type Clip } from "@/components/Documentary";
import Logo from "@/components/Logo";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project } = await supabase.from("projects").select("*").eq("id", id).single();
  if (!project) notFound();

  const [{ data: chars }, { data: scenes }, { data: shots }, { data: profile }] = await Promise.all([
    supabase.from("characters").select("*").eq("project_id", id).order("created_at"),
    supabase.from("scenes").select("*").eq("project_id", id).order("position"),
    supabase.from("shots").select("*").eq("project_id", id).order("position"),
    supabase.from("profiles").select("credits").eq("id", user.id).single(),
  ]);

  const nameById = new Map((chars ?? []).map((c) => [c.id, c.name as string]));

  const characters: CharacterView[] = await Promise.all(
    (chars ?? []).map(async (c) => ({
      id: c.id,
      name: c.name,
      age: c.age ?? "",
      appearance: c.appearance ?? "",
      status: c.status,
      error: c.error,
      imageUrl: await signedUrl("character-refs", c.reference_urls?.[0]),
    }))
  );

  const sceneViews: SceneView[] = await Promise.all(
    (scenes ?? []).map(async (s) => ({
      id: s.id,
      position: s.position,
      summary: s.summary ?? "",
      narration: s.narration ?? "",
      shots: await Promise.all(
        (shots ?? [])
          .filter((sh) => sh.scene_id === s.id)
          .map(async (sh) => ({
            id: sh.id,
            position: sh.position,
            prompt: sh.prompt,
            status: sh.status,
            error: sh.error,
            duration: sh.duration_seconds,
            people: (sh.character_ids ?? []).map((cid: string) => nameById.get(cid)).filter(Boolean) as string[],
            keyframeUrl: await signedUrl("keyframes", sh.keyframe_url),
            videoUrl: await signedUrl("videos", sh.video_url),
          }))
      ),
    }))
  );

  // Playlist for the documentary player: one clip per shot that already has a picture or video.
  // The scene narration is split across the scene's shots so each caption stays short.
  const clips: Clip[] = sceneViews.flatMap((s) => {
    const words = s.narration.split(/\s+/).filter(Boolean);
    const per = Math.max(1, Math.ceil(words.length / Math.max(1, s.shots.length)));
    const sceneClips = s.shots.flatMap((sh, j) => {
      const src = sh.videoUrl ?? sh.keyframeUrl;
      if (!src) return [];
      const kind: Clip["kind"] = sh.videoUrl ? "video" : "image";
      return [{ kind, src, duration: sh.duration, caption: words.slice(j * per, (j + 1) * per).join(" "), speak: "" }];
    });
    return sceneClips.map((c, k) => ({ ...c, speak: k === 0 ? s.narration : "" }));
  });

  return (
    <>
      <header className="topbar">
        <Link href="/dashboard">
          <Logo size={36} tone="light" tagline={false} />
        </Link>
        <Link href="/credits" className="credits">
          Credits: <b>{profile?.credits ?? 0}</b> · Nunua
        </Link>
      </header>
      <main className="wrap">
        <div className="proj-head">
          <p className="muted"><Link href="/dashboard">Miradi yote</Link></p>
          <h1>{project.title}</h1>
        </div>
        {clips.length > 0 && <Documentary clips={clips} title={project.title} language={project.language ?? "sw"} />}
        <Storyboard projectId={id} characters={characters} scenes={sceneViews} />
      </main>
    </>
  );
}
