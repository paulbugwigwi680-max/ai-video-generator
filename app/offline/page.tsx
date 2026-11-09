import Logo from "@/components/Logo";

export const metadata = { title: "Hakuna mtandao" };

// Shown by the app when the phone has no internet connection.
export default function Offline() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <Logo stacked size={64} />
        </div>
        <h1>Hakuna mtandao</h1>
        <p className="auth-sub">
          BUGWIGWI inahitaji intaneti kutengeneza video. Washa data au Wi-Fi, kisha jaribu tena.
        </p>
        <a href="/dashboard" className="btn-big">Jaribu tena</a>
      </div>
    </main>
  );
}
