import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { buildSpaceInput } from "../worker";

describe("buildSpaceInput", () => {
	it("maps options onto the Space's positional inputs", () => {
		const data = buildSpaceInput({
			prompt: "a fox",
			model: "sft",
			width: 1000,
			height: 1530,
			steps: 30,
			cfg: 4,
			seed: 7,
		});
		expect(data).toHaveLength(16);
		expect(data.slice(0, 9)).toEqual(["a fox", "watermark, bad anatomy", "sft", 1008, 1536, 30, 4, 5, 7]);
	});

	it("clamps out-of-range values and falls back to defaults", () => {
		const data = buildSpaceInput({ prompt: "x", width: 99999, steps: -5, cfg: Number.NaN });
		expect(data[2]).toBe("base");
		expect(data[3]).toBe(2048);
		expect(data[4]).toBe(1024);
		expect(data[5]).toBe(1);
		expect(data[6]).toBe(3);
		expect(data[8]).toBe(-1);
	});
});

describe("worker routes", () => {
	it("rejects an empty prompt", async () => {
		const res = await SELF.fetch("https://example.com/api/generate", {
			method: "POST",
			body: JSON.stringify({ prompt: "  " }),
		});
		expect(res.status).toBe(400);
	});

	it("only proxies images from the MOSS-Image Space", async () => {
		const res = await SELF.fetch(
			"https://example.com/api/image?src=" + encodeURIComponent("https://evil.example/x.png"),
		);
		expect(res.status).toBe(400);
	});
});
