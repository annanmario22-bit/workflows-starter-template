// Secrets aren't in wrangler.jsonc, so `wrangler types` doesn't generate them
interface Env {
	WAVESPEED_API_KEY: string;
	ACCESS_PASSWORD: string;
}
