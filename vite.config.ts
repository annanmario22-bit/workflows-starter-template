import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
	// `--mode pages` builds a static site (no Worker) that calls the Space directly.
	if (mode === "pages") {
		return {
			base: "./",
			plugins: [react()],
			define: { "import.meta.env.VITE_DIRECT": JSON.stringify("1") },
			build: { outDir: "dist-pages" },
		};
	}
	return { plugins: [react(), cloudflare()] };
});
