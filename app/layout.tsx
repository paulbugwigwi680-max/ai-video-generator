import type { Metadata } from "next";
import { Bricolage_Grotesque, Public_Sans } from "next/font/google";
import "./globals.css";

const head = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
const body = Public_Sans({ subsets: ["latin"], variable: "--font-public" });

export const metadata: Metadata = {
  title: "BUGWIGWI | AI Video Studio",
  description: "Tengeneza video na documentary za AI zenye wahusika wasiobadilika.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sw" className={`${head.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
