import { buildSpaceInput, ENDPOINT, SPACE_API } from "./space";

/**
 * Static builds (GitHub Pages) have no Worker, so they call the Space directly;
 * it allows cross-origin requests. The Worker build goes through /api.
 */
const DIRECT = import.meta.env.VITE_DIRECT === "1";

export interface GenerateOptions {
	prompt: string;
	negativePrompt: string;
	model: "base" | "sft";
	width: number;
	height: number;
	steps: number;
	cfg: number;
	seed: number;
}

export interface GenerateResult {
	images: string[];
	status: string;
}

function collectUrls(value: unknown, out: string[] = []): string[] {
	if (Array.isArray(value)) {
		value.forEach((v) => collectUrls(v, out));
	} else if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		if (typeof obj.url === "string") out.push(obj.url);
		else Object.values(obj).forEach((v) => collectUrls(v, out));
	}
	return out;
}

function cleanError(raw: string): string {
	try {
		const parsed = JSON.parse(raw);
		const msg = parsed?.error ?? parsed?.message;
		if (typeof msg === "string") {
			// Strip wrapping quotes and turn markdown links into plain text.
			return msg.replace(/^'+|'+$/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
		}
	} catch {
		// fall through
	}
	return raw && raw !== "null" ? raw : "The Space reported an error without details.";
}

function authHeaders(token: string): Record<string, string> {
	if (!token) return {};
	return DIRECT ? { Authorization: `Bearer ${token}` } : { "X-HF-Token": token };
}

/** Queues the job and returns the response plus its event id (when it worked). */
async function startGeneration(
	opts: GenerateOptions,
	token: string,
	signal: AbortSignal,
): Promise<[Response, string | undefined]> {
	const headers = { "Content-Type": "application/json", ...authHeaders(token) };
	if (DIRECT) {
		const res = await fetch(`${SPACE_API}/call/${ENDPOINT}`, {
			method: "POST",
			headers,
			body: JSON.stringify({ data: buildSpaceInput(opts) }),
			signal,
		});
		if (!res.ok) {
			throw new Error(`The MOSS-Image Space returned ${res.status}. It may be restarting; try again in a minute.`);
		}
		const body = (await res.json()) as { event_id?: string };
		return [res, body.event_id];
	}
	const res = await fetch("/api/generate", { method: "POST", headers, body: JSON.stringify(opts), signal });
	const body = res.ok ? ((await res.clone().json().catch(() => ({}))) as { eventId?: string }) : {};
	return [res, body.eventId];
}

/**
 * Queues a generation and waits for the result by reading
 * the Space's server-sent events stream.
 */
export async function generateImage(
	opts: GenerateOptions,
	token: string,
	signal: AbortSignal,
): Promise<GenerateResult> {
	const [startRes, eventId] = await startGeneration(opts, token, signal);
	if (!eventId) {
		const body = (await startRes.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `Could not start generation (${startRes.status}).`);
	}

	const stream = await fetch(
		DIRECT ? `${SPACE_API}/call/${ENDPOINT}/${eventId}` : `/api/generate/${eventId}`,
		{ headers: authHeaders(token), signal },
	);
	if (!stream.ok || !stream.body) {
		throw new Error(`Lost connection to the Space (${stream.status}).`);
	}

	const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";
	let event = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += value;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (line.startsWith("event:")) {
				event = line.slice(6).trim();
			} else if (line.startsWith("data:")) {
				const data = line.slice(5).trim();
				if (event === "error") throw new Error(cleanError(data));
				if (event === "complete") {
					const parsed = JSON.parse(data) as unknown[];
					const images = collectUrls(parsed[0]);
					const status = typeof parsed[1] === "string" ? parsed[1] : "";
					if (!images.length) throw new Error(status || "The Space returned no image.");
					return { images, status };
				}
			}
		}
	}
	throw new Error("The Space closed the connection before the image was ready.");
}

/** Same-origin URL for a generated image, so it can be saved or shared. */
export const localImageUrl = (src: string) =>
	DIRECT ? src : `/api/image?src=${encodeURIComponent(src)}`;
