import type { MetadataRoute } from "next";

// Makes the website installable on a phone ("Add to Home screen" / "Install app").
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BUGWIGWI AI Video Studio",
    short_name: "BUGWIGWI",
    description: "Tengeneza documentary na video za AI kwa Kiswahili.",
    lang: "sw",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#17212b",
    theme_color: "#17212b",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Miradi yangu", short_name: "Miradi", url: "/dashboard" },
      { name: "Picha inayoongea", short_name: "Picha", url: "/talk" },
      { name: "Nunua credits", short_name: "Credits", url: "/credits" },
    ],
  };
}
