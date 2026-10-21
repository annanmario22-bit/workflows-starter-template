/**
 * Cosmos Predict 2.5 server
 *
 * Proxies WaveSpeed AI so the API key stays on the server and never reaches
 * the phone. Every /api route requires the ACCESS_PASSWORD as a Bearer token.
 *
 * - POST /api/generate     { prompt } -> { id, status }
 * - GET  /api/result/:id   -> { id, status, outputs, error }
 */

const WAVESPEED_BASE = "https://api.wavespeed.ai/api/v3";
const MODEL_PATH = "wavespeed-ai/cosmos-predict-2.5/text-to-video";
const MAX_PROMPT_LENGTH = 4000;

type WaveSpeedTask = {
	id: string;
	status: string;
	outputs?: string[];
	error?: string;
	created_at?: string;
};

type WaveSpeedResponse = {
	code?: number;
	message?: string;
	data?: WaveSpeedTask;
};

/** Constant-time string comparison so the password can't be guessed by timing */
async function safeEqual(a: string, b: string): Promise<boolean> {
	const enc = new TextEncoder();
	const [ha, hb] = await Promise.all([
		crypto.subtle.digest("SHA-256", enc.encode(a)),
		crypto.subtle.digest("SHA-256", enc.encode(b)),
	]);
	return crypto.subtle.timingSafeEqual(ha, hb);
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
	if (!env.ACCESS_PASSWORD) return false;
	const header = request.headers.get("Authorization") ?? "";
	const token = header.startsWith("Bearer ") ? header.slice(7) : "";
	return token.length > 0 && safeEqual(token, env.ACCESS_PASSWORD);
}

function taskJson(task: WaveSpeedTask) {
	return {
		id: task.id,
		status: task.status,
		outputs: task.outputs ?? [],
		error: task.error || null,
		createdAt: task.created_at ?? null,
	};
}

async function callWaveSpeed(
	env: Env,
	path: string,
	init?: RequestInit,
): Promise<Response> {
	const upstream = await fetch(`${WAVESPEED_BASE}/${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${env.WAVESPEED_API_KEY}`,
			"Content-Type": "application/json",
		},
	});

	const body = (await upstream.json().catch(() => null)) as
		| WaveSpeedResponse
		| null;

	if (!upstream.ok || !body?.data) {
		return Response.json(
			{ error: body?.message || `WaveSpeed returned ${upstream.status}` },
			{ status: upstream.status >= 400 ? upstream.status : 502 },
		);
	}

	return Response.json(taskJson(body.data));
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (!url.pathname.startsWith("/api/")) {
			return Response.json({ error: "Not Found" }, { status: 404 });
		}

		if (!env.WAVESPEED_API_KEY || !env.ACCESS_PASSWORD) {
			return Response.json(
				{
					error:
						"Server not configured: set WAVESPEED_API_KEY and ACCESS_PASSWORD secrets",
				},
				{ status: 500 },
			);
		}

		if (!(await isAuthorized(request, env))) {
			return Response.json({ error: "Wrong password" }, { status: 401 });
		}

		// API: Check the password without spending credits
		if (url.pathname === "/api/auth" && request.method === "POST") {
			return Response.json({ ok: true });
		}

		// API: Submit a text-to-video task. Never retried automatically, since
		// a retry after an unclear failure could create a second billed task.
		if (url.pathname === "/api/generate" && request.method === "POST") {
			const body = (await request.json().catch(() => null)) as {
				prompt?: unknown;
			} | null;
			const prompt =
				typeof body?.prompt === "string" ? body.prompt.trim() : "";

			if (!prompt) {
				return Response.json({ error: "Prompt is required" }, { status: 400 });
			}
			if (prompt.length > MAX_PROMPT_LENGTH) {
				return Response.json(
					{ error: `Prompt must be under ${MAX_PROMPT_LENGTH} characters` },
					{ status: 400 },
				);
			}

			return callWaveSpeed(env, MODEL_PATH, {
				method: "POST",
				body: JSON.stringify({ prompt }),
			});
		}

		// API: Poll a task's result
		const resultMatch = url.pathname.match(/^\/api\/result\/([\w-]+)$/);
		if (resultMatch && request.method === "GET") {
			return callWaveSpeed(env, `predictions/${resultMatch[1]}/result`);
		}

		return Response.json({ error: "Not Found" }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
