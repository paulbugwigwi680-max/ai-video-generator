type Props = {
  size?: number;
  stacked?: boolean;
  tone?: "dark" | "light";
  tagline?: boolean;
};

export default function Logo({ size = 44, stacked = false, tone = "dark", tagline = true }: Props) {
  return (
    <span className={`logo${stacked ? " stacked" : ""} ${tone}`} aria-label="BUGWIGWI">
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-hidden="true">
        <rect width="48" height="48" rx="12" fill="#0A5C64" />
        <rect x="1.5" y="1.5" width="45" height="45" rx="10.5" fill="none" stroke="#0E7C86" strokeWidth="1.5" />
        <circle cx="9" cy="14" r="1.7" fill="#fff" opacity="0.55" />
        <circle cx="9" cy="24" r="1.7" fill="#fff" opacity="0.55" />
        <circle cx="9" cy="34" r="1.7" fill="#fff" opacity="0.55" />
        <path
          d="M20 14.5 L20 33.5 L35 24 Z"
          fill="#C9A45A"
          stroke="#C9A45A"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </svg>
      <span className="logo-text">
        <span className="logo-word">BUGWIGWI</span>
        {tagline && <span className="logo-tag">AI VIDEO STUDIO</span>}
      </span>
    </span>
  );
}
