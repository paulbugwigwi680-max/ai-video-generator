"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type CharacterView = {
  id: string; name: string; age: string; appearance: string;
  status: string; error: string | null; imageUrl: string | null;
};
export type ShotView = {
  id: string; position: number; prompt: string; status: string; error: string | null;
  duration: number; people: string[]; keyframeUrl: string | null; videoUrl: string | null;
};
export type SceneView = { id: string; position: number; summary: string; narration: string; shots: ShotView[] };

const LABEL: Record<string, string> = {
  draft: "Haijaanza", queued: "Foleni", processing: "Inatengenezwa", completed: "Tayari", failed: "Imeshindikana",
};

export default function Storyboard({
  projectId, characters, scenes,
}: { projectId: string; characters: CharacterView[]; scenes: SceneView[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [bulk, setBulk] = useState(false);

  // Live updates: when a webhook finishes a job, refresh the page data.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`project-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "shots", filter: `project_id=eq.${projectId}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "characters", filter: `project_id=eq.${projectId}` }, () => router.refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, router]);

  async function call(url: string) {
    setMsg("");
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? "Hitilafu imetokea.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function runAll(urls: string[]) {
    setBulk(true);
    for (const u of urls) {
      const ok = await call(u);
      if (!ok) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    setBulk(false);
  }

  const allShots = scenes.flatMap((s) => s.shots);
  const needChars = characters.filter((c) => c.status !== "processing" && !c.imageUrl).map((c) => `/api/characters/${c.id}/sheet`);
  const needFrames = allShots.filter((s) => s.status !== "processing" && !s.keyframeUrl).map((s) => `/api/shots/${s.id}/keyframe`);
  const needVideos = allShots.filter((s) => s.status !== "processing" && s.keyframeUrl && !s.videoUrl).map((s) => `/api/shots/${s.id}/video`);

  return (
    <>
      <div className="bulk">
        <button disabled={bulk || !needChars.length} onClick={() => runAll(needChars)}>1. Wahusika wote ({needChars.length})</button>
        <button disabled={bulk || !needFrames.length} onClick={() => runAll(needFrames)}>2. Picha zote za mwanzo ({needFrames.length})</button>
        <button disabled={bulk || !needVideos.length} onClick={() => runAll(needVideos)}>3. Video zote ({needVideos.length})</button>
      </div>
      {msg && <p className="msg" role="alert">{msg}</p>}

      <div className="layout" style={{ marginTop: 32 }}>
        <aside className="rail">
          <h2>Wahusika</h2>
          {characters.length === 0 && <p className="muted">Mradi huu hauna wahusika (video za mandhari tu).</p>}
          {characters.map((c) => (
            <div className="char" key={c.id}>
              <div className="portrait">
                {c.imageUrl ? <img src={c.imageUrl} alt={c.name} /> : <span className={c.status === "processing" ? "pulse" : ""}>{LABEL[c.status]}</span>}
              </div>
              <h3>{c.name}</h3>
              <p>{c.age}. {c.appearance}</p>
              {c.error && <p className="status failed">{c.error}</p>}
              <button className="ghost small" disabled={c.status === "processing" || bulk} onClick={() => call(`/api/characters/${c.id}/sheet`)}>
                {c.imageUrl ? "Tengeneza upya (credits 2)" : "Tengeneza sura (credits 2)"}
              </button>
            </div>
          ))}
        </aside>

        <section className="scenes">
          <h2>Hadithi</h2>
          {scenes.map((s) => (
            <article className="scene" key={s.id}>
              <h3>Onyesho {s.position}: {s.summary}</h3>
              <p className="narration">{s.narration}</p>
              <div className="shots">
                {s.shots.map((sh) => (
                  <div className="shot" key={sh.id}>
                    <div className="frame">
                      {sh.videoUrl ? (
                        <video src={sh.videoUrl} controls playsInline poster={sh.keyframeUrl ?? undefined} />
                      ) : sh.keyframeUrl ? (
                        <img src={sh.keyframeUrl} alt={sh.prompt} />
                      ) : (
                        <span className={sh.status === "processing" ? "pulse" : ""}>{LABEL[sh.status]}</span>
                      )}
                    </div>
                    <p className="prompt">{sh.people.length ? `${sh.people.join(", ")}: ` : ""}{sh.prompt}</p>
                    <div className="row">
                      <span className={`status ${sh.status}`}>{LABEL[sh.status]} · {sh.duration}s</span>
                    </div>
                    {sh.error && <p className="status failed">{sh.error}</p>}
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="ghost small" disabled={sh.status === "processing" || bulk} onClick={() => call(`/api/shots/${sh.id}/keyframe`)}>
                        {sh.keyframeUrl ? "Picha upya (1)" : "Picha ya mwanzo (1)"}
                      </button>
                      <button className="small" disabled={!sh.keyframeUrl || sh.status === "processing" || bulk} onClick={() => call(`/api/shots/${sh.id}/video`)}>
                        {sh.videoUrl ? "Video upya" : "Tengeneza video"} ({sh.duration >= 8 ? 10 : 5})
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
