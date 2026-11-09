"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// Registers the service worker and offers "install on your phone".
export default function PwaRegister() {
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("bugwigwi-install-dismissed") === "1";
    } catch {
      /* private mode */
    }
    if (standalone || dismissed) return;

    const ua = navigator.userAgent;
    const iosSafari = /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    if (iosSafari) setIosHint(true);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => setInstall(null);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setInstall(null);
    setIosHint(false);
    try {
      localStorage.setItem("bugwigwi-install-dismissed", "1");
    } catch {
      /* ignore */
    }
  }

  async function doInstall() {
    if (!install) return;
    await install.prompt();
    await install.userChoice.catch(() => null);
    setInstall(null);
  }

  if (!install && !iosHint) return null;

  return (
    <div className="install" role="dialog" aria-label="Weka BUGWIGWI kwenye simu">
      <div style={{ flex: 1, minWidth: 200 }}>
        <strong>Weka BUGWIGWI kwenye simu yako</strong>
        <div className="muted" style={{ fontSize: "0.85rem" }}>
          {install
            ? "Inafunguka kama app, bila kivinjari."
            : "Bonyeza kitufe cha Share (mraba wenye mshale) kisha chagua “Add to Home Screen”."}
        </div>
      </div>
      <div className="row">
        {install && <button className="small" onClick={doInstall}>Weka</button>}
        <button className="ghost small" onClick={dismiss}>Baadaye</button>
      </div>
    </div>
  );
}
