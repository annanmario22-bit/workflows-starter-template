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

/**
 * Queues a generation through the Worker and waits for the result by reading
 * the Space's server-sent events stream.
 */
export async function generateImage(
	opts: GenerateOptions,
	token: string,
	signal: AbortSignal,
): Promise<GenerateResult> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (token) headers["X-HF-Token"] = token;

	const start = await fetch("/api/generate", {
		method: "POST",
		headers,
		body: JSON.stringify(opts),
		signal,
	});
	const started = (await start.json().catch(() => ({}))) as {
		eventId?: string;
		error?: string;
	};
	if (!start.ok || !started.eventId) {
		throw new Error(started.error ?? `Could not start generation (${start.status}).`);
	}

	const streamHeaders: Record<string, string> = {};
	if (token) streamHeaders["X-HF-Token"] = token;
	const stream = await fetch(`/api/generate/${started.eventId}`, {
		headers: streamHeaders,
		signal,
	});
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
	`/api/image?src=${encodeURIComponent(src)}`;
