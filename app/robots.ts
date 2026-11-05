import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard", "/project/", "/credits", "/talk", "/reset-password", "/auth/"],
      },
    ],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
