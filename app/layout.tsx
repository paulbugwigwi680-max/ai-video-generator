import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Public_Sans } from "next/font/google";
import "./globals.css";
import { appUrl } from "@/lib/config";
import PwaRegister from "@/components/PwaRegister";
import BottomNav from "@/components/BottomNav";

const head = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
const body = Public_Sans({ subsets: ["latin"], variable: "--font-public" });

const TITLE = "BUGWIGWI | Documentary na video za AI kwa Kiswahili";
const DESCRIPTION =
  "Tengeneza documentary na video za AI kwa Kiswahili: script, wahusika wasiobadilika, picha na simulizi. Anza sasa.";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: TITLE, template: "%s | BUGWIGWI" },
  description: DESCRIPTION,
  applicationName: "BUGWIGWI",
  keywords: [
    "documentary za AI",
    "video za AI Kiswahili",
    "AI video generator",
    "tengeneza video kwa AI",
    "BUGWIGWI",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "BUGWIGWI",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    locale: "sw_TZ",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
  appleWebApp: { capable: true, title: "BUGWIGWI", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  // Optional: only needed if you verify Google Search Console with the meta tag method.
  verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION },
};

// Phone look: dark status bar, content can use the whole screen (notch safe areas are handled in CSS).
export const viewport: Viewport = {
  themeColor: "#17212b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "BUGWIGWI",
    url: appUrl(),
    description: DESCRIPTION,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    inLanguage: "sw",
  };

  return (
    <html lang="sw" className={`${head.variable} ${body.variable}`}>
      <body>
        {children}
        <BottomNav />
        <PwaRegister />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </body>
    </html>
  );
}
