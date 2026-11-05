import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: appUrl(), lastModified: new Date(), changeFrequency: "weekly", priority: 1 }];
}
