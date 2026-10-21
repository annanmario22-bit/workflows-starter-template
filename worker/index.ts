/**
 * MOSS-Image mobile backend
 *
 * Proxies the public MOSS-Image Hugging Face Space so the phone UI can
 * generate images without CORS issues, and attaches a Hugging Face token
 * (ZeroGPU quota for anonymous callers runs out quickly):
 * - POST /api/generate - Queue a generation, returns { eventId }
 * - GET /api/generate/:id - Server-sent events stream for that generation
 * - GET /api/image?src=... - Same-origin copy of a generated image (for saving)
 */

export const SPACE_API = "https://openmoss-team-moss-image.hf.space/gradio_api";
const ENDPOINT = "generated_images";

export interface GenerateRequest {
	prompt: string;
	negativePrompt?: string;
	model?: "base" | "sft";
	width?: number;
	height?: number;
	steps?: number;
	cfg?: number;
	seed?: number;
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
};

/** Builds the positional `data` array the Space's /generated_images endpoint expects. */
export function buildSpaceInput(req: GenerateRequest): unknown[] {
	// Dimensions must be multiples of 16 for the model.
	const dim = (v: unknown, fallback: number) =>
		Math.round(clamp(v, 256, 2048, fallback) / 16) * 16;
	const cfg = Number(req.cfg);

	return [
		req.prompt.slice(0, 16000),
		(req.negativePrompt ?? "watermark, bad anatomy").slice(0, 2000),
		req.model === "sft" ? "sft" : "base",
		dim(req.width, 1024),
		dim(req.height, 1024),
		clamp(req.steps, 1, 100, 50),
		Number.isFinite(cfg) ? Math.min(20, Math.max(0, cfg)) : 3,
		5, // shift
		clamp(req.seed, -1, 4294967295, -1),
		1, // images per run
		4096, // max text length
		"22", // skip layers (uncond)
		"", // SLG layers
		0, // SLG scale
		0, // skip start
		1, // skip stop
	];
}

function authHeaders(request: Request, env: Env): Record<string, string> {
	const token = request.headers.get("X-HF-Token")?.trim() || env.HF_TOKEN;
	return token ? { Authorization: `Bearer ${token}` } : {};
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// API: Queue a new generation on the Space
		if (url.pathname === "/api/generate" && request.method === "POST") {
			let body: GenerateRequest;
			try {
				body = await request.json();
			} catch {
				return Response.json({ error: "Invalid JSON body" }, { status: 400 });
			}
			if (typeof body.prompt !== "string" || !body.prompt.trim()) {
				return Response.json({ error: "Prompt is required" }, { status: 400 });
			}

			const upstream = await fetch(`${SPACE_API}/call/${ENDPOINT}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...authHeaders(request, env) },
				body: JSON.stringify({ data: buildSpaceInput(body) }),
			});
			if (!upstream.ok) {
				return Response.json(
					{ error: `The MOSS-Image Space returned ${upstream.status}. It may be restarting; try again in a minute.` },
					{ status: 502 },
				);
			}
			const { event_id } = await upstream.json<{ event_id: string }>();
			return Response.json({ eventId: event_id });
		}

		// API: Stream generation progress (server-sent events passthrough)
		const streamMatch = url.pathname.match(/^\/api\/generate\/([\w-]+)$/);
		if (streamMatch && request.method === "GET") {
			const upstream = await fetch(`${SPACE_API}/call/${ENDPOINT}/${streamMatch[1]}`, {
				headers: authHeaders(request, env),
			});
			return new Response(upstream.body, {
				status: upstream.status,
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
				},
			});
		}

		// API: Same-origin copy of a generated image so the phone can save/share it
		if (url.pathname === "/api/image" && request.method === "GET") {
			const src = url.searchParams.get("src") ?? "";
			if (!src.startsWith(`${SPACE_API}/file=`)) {
				return Response.json({ error: "Unsupported image source" }, { status: 400 });
			}
			const upstream = await fetch(src);
			return new Response(upstream.body, {
				status: upstream.status,
				headers: {
					"Content-Type": upstream.headers.get("Content-Type") ?? "image/webp",
					"Cache-Control": "public, max-age=86400",
				},
			});
		}

		return Response.json({ error: "Not Found" }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
