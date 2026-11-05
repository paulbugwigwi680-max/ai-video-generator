import { ImageResponse } from "next/og";

export const alt = "BUGWIGWI AI Video Studio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#17212b",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", color: "#c9a45a", fontSize: 30, letterSpacing: 8 }}>AI VIDEO STUDIO</div>
        <div style={{ display: "flex", fontSize: 120, fontWeight: 800, letterSpacing: 10, marginTop: 10 }}>BUGWIGWI</div>
        <div style={{ display: "flex", fontSize: 40, marginTop: 24, color: "#d6dde3" }}>
          Documentary za AI zenye wahusika wasiobadilika
        </div>
        <div style={{ display: "flex", marginTop: 40, width: 220, height: 10, background: "#0e7c86" }} />
      </div>
    ),
    size
  );
}
