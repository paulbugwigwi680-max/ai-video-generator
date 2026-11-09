import { ImageResponse } from "next/og";

// App icon for the phone home screen, drawn on demand (no image files needed).
// /pwa-icon/192, /pwa-icon/512 and /pwa-icon/512?maskable=1 (full-bleed version for Android).
export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = Math.min(1024, Math.max(48, parseInt(size, 10) || 192));
  const maskable = new URL(req.url).searchParams.get("maskable") === "1";
  const inner = Math.round(px * (maskable ? 0.46 : 0.52));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0A5C64",
          borderRadius: maskable ? 0 : Math.round(px * 0.22),
        }}
      >
        <svg width={inner} height={inner} viewBox="0 0 48 48">
          <path
            d="M20 14.5 L20 33.5 L35 24 Z"
            fill="#C9A45A"
            stroke="#C9A45A"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { width: px, height: px }
  );
}
