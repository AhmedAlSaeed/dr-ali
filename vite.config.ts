import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  // stamped into the bundle: content.json is fetched with ?v=<build>, so a cached copy from a
  // previous deploy (GitHub Pages serves it with max-age=600) is never used
  define: { __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16)) },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
