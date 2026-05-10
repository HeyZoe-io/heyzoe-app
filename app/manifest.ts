import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Hey Zoe",
    short_name: "Hey Zoe",
    description: "דשבורד HeyZoe — זואי, שיחות ואנליטיקס",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#7133da",
    lang: "he",
    dir: "rtl",
    icons: [
      {
        src: "/pwa-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
