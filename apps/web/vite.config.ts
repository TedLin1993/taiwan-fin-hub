import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  server: {
    proxy: {
      "/api": "http://localhost:8787"
    }
  },
  build: {
    target: ["es2022", "chrome111", "firefox128", "safari16.4"]
  }
});
