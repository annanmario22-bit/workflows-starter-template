import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					bindings: {
						WAVESPEED_API_KEY: "test-key",
						ACCESS_PASSWORD: "secret",
					},
				},
			},
		},
	},
});
