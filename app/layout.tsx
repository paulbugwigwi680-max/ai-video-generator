import type { Metadata } from "next";
import { Bricolage_Grotesque, Public_Sans } from "next/font/google";
import "./globals.css";
import { appUrl } from "@/lib/config";

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
  // Optional: only needed if you verify Google Search Console with the meta tag method.
  verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION },
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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </body>
    </html>
  );
}
