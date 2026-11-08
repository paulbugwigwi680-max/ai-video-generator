"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { shrinkImage } from "@/lib/image-utils";

export type CharacterView = {
  id: string; name: string; age: string; appearance: string;
  status: string; error: string | null; imageUrl: string | null; userPhoto: boolean;
};
export type ShotView = {
  id: string; position: number; prompt: string; status: string; error: string | null;
  duration: number; people: string[]; characterIds: string[];
  keyframeUrl: string | null; videoUrl: string | null;
};
export type SceneView = { id: string; position: number; summary: string; narration: string; shots: ShotView[] };

const LABEL: Record<string, string> = {
  draft: "Haijaanza", queued: "Foleni", processing: "Inatengenezwa", completed: "Tayari", failed: "Imeshindikana",
};

// Shrinks the photo in the browser, then sends it to the server.
async function uploadPhoto(characterId: string, file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Chagua faili la picha.");
  const blob = await shrinkImage(file);
  const form = new FormData();
  form.append("file", blob, "photo.jpg");
  const res = await fetch(`/api/characters/${characterId}/photo`, { method: "POST", body: form });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? "Imeshindwa kupakia picha.");
  }
}

function AddCharacter({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [appearance, setAppearance] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/projects/${projectId}/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, age, appearance }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Imeshindwa kuongeza mhusika.");
      if (file) await uploadPhoto(j.id, file);
      setName("");
      setAge("");
      setAppearance("");
      setFile(null);
      setOpen(false);
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
    setBusy(false);
  }

  if (!open) {
    return <button className="ghost small" onClick={() => setOpen(true)}>+ Ongeza mhusika wangu</button>;
  }
  return (
    <form className="addchar" onSubmit={submit}>
      <label htmlFor="ac-name">Jina</label>
      <input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
      <label htmlFor="ac-age">Umri (hiari)</label>
      <input id="ac-age" value={age} onChange={(e) => setAge(e.target.value)} maxLength={40} />
      <label htmlFor="ac-app">Maelezo ya sura (hiari)</label>
      <textarea id="ac-app" rows={3} value={appearance} onChange={(e) => setAppearance(e.target.value)} maxLength={400} />
      <label htmlFor="ac-file">Picha yake (hiari)</label>
      <input id="ac-file" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="row" style={{ marginTop: 12 }}>
        <button type="submit" className="small" disabled={busy}>{busy ? "Subiri…" : "Ongeza"}</button>
        <button type="button" className="ghost small" onClick={() => setOpen(false)}>Ghairi</button>
      </div>
      {err && <p className="error">{err}</p>}
    </form>
  );
}

export default function Storyboard({
  projectId, characters, scenes,
}: { projectId: string; characters: CharacterView[]; scenes: SceneView[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [bulk, setBulk] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

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

  async function onPhoto(characterId: string, file: File | undefined) {
    if (!file) return;
    setMsg("");
    setUploading(characterId);
    try {
      await uploadPhoto(characterId, file);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setUploading(null);
  }

  async function toggleCharacter(shot: ShotView, characterId: string) {
    const next = shot.characterIds.includes(characterId)
      ? shot.characterIds.filter((x) => x !== characterId)
      : [...shot.characterIds, characterId];
    const res = await fetch(`/api/shots/${shot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterIds: next }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? "Hitilafu imetokea.");
      return;
    }
    router.refresh();
  }

  const allShots = scenes.flatMap((s) => s.shots);
  const needChars = characters.filter((c) => c.status !== "processing" && !c.imageUrl).map((c) => `/api/characters/${c.id}/sheet`);
  const needFrames = allShots.filter((s) => s.status !== "processing" && !s.keyframeUrl).map((s) => `/api/shots/${s.id}/keyframe`);
  const needVideos = allShots
    .filter((s) => s.keyframeUrl && s.status !== "processing" && s.status !== "completed")
    .map((s) => `/api/shots/${s.id}/video`);

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
          {characters.length === 0 && <p className="muted">Mradi huu hauna wahusika.</p>}
          {characters.map((c) => (
            <div className="char" key={c.id}>
              <div className="portrait">
                {c.imageUrl ? <img src={c.imageUrl} alt={c.name} /> : <span className={c.status === "processing" ? "pulse" : ""}>{LABEL[c.status]}</span>}
              </div>
              <h3>{c.name}{c.userPhoto && <span className="badge">picha yako</span>}</h3>
              <p>{[c.age, c.appearance].filter(Boolean).join(". ")}</p>
              {c.error && <p className="status failed">{c.error}</p>}
              <div className="row">
                <label className={`filebtn${uploading === c.id || bulk ? " disabled" : ""}`}>
                  {uploading === c.id ? "Inapakia…" : "Pakia picha yangu"}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={uploading === c.id || bulk}
                    onChange={(e) => { onPhoto(c.id, e.target.files?.[0]); e.target.value = ""; }}
                  />
                </label>
                <button className="ghost small" disabled={c.status === "processing" || bulk} onClick={() => call(`/api/characters/${c.id}/sheet`)}>
                  {c.imageUrl ? "Tengeneza upya kwa AI (2)" : "Tengeneza kwa AI (2)"}
                </button>
              </div>
            </div>
          ))}
          <AddCharacter projectId={projectId} onDone={() => router.refresh()} />
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
                    {characters.length > 0 && (
                      <details className="who">
                        <summary>Wahusika kwenye shot hii ({sh.characterIds.length})</summary>
                        {characters.map((c) => (
                          <label className="who-item" key={c.id}>
                            <input
                              type="checkbox"
                              checked={sh.characterIds.includes(c.id)}
                              onChange={() => toggleCharacter(sh, c.id)}
                            />
                            {c.name}
                          </label>
                        ))}
                      </details>
                    )}
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
