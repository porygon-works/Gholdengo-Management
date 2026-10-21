import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Gholdengo 家計簿",
        short_name: "家計簿",
        lang: "ja",
        start_url: "/",
        display: "standalone",
        background_color: "#f2f5f1",
        theme_color: "#1d6a50",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: { navigateFallback: "/index.html", globPatterns: ["**/*.{js,css,html,svg,png}"] },
    }),
  ],
  test: { include: ["src/**/*.test.ts", "gas/**/*.test.ts"], globalSetup: ["gas/copy-for-test.ts"] },
});
