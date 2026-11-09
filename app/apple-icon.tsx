import { ImageResponse } from "next/og";

// Icon used by iPhone / iPad when the site is added to the home screen.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
        }}
      >
        <svg width={92} height={92} viewBox="0 0 48 48">
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
    size
  );
}
