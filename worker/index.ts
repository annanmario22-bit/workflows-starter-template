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

import { buildSpaceInput, ENDPOINT, SPACE_API, type GenerateRequest } from "../src/space";

export { buildSpaceInput };

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
