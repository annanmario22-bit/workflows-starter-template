/** Shared details of the MOSS-Image Hugging Face Space API (used by the app and the Worker). */

export const SPACE_API = "https://openmoss-team-moss-image.hf.space/gradio_api";
export const ENDPOINT = "generated_images";

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
