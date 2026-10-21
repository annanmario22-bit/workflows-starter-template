import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import worker from "../worker/index";

const WAVESPEED = "https://api.wavespeed.ai";

function call(path: string, init: RequestInit = {}, password = "secret") {
	const request = new Request(`https://app.test${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${password}`,
			"Content-Type": "application/json",
		},
	});
	return worker.fetch(request, env);
}

beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

describe("auth", () => {
	it("rejects a wrong password", async () => {
		const res = await call("/api/auth", { method: "POST" }, "nope");
		expect(res.status).toBe(401);
	});

	it("accepts the right password", async () => {
		const res = await call("/api/auth", { method: "POST" });
		expect(res.status).toBe(200);
	});
});

describe("generate", () => {
	it("submits the prompt with the server's API key", async () => {
		fetchMock
			.get(WAVESPEED)
			.intercept({
				path: "/api/v3/wavespeed-ai/cosmos-predict-2.5/text-to-video",
				method: "POST",
				headers: { Authorization: "Bearer test-key" },
				body: JSON.stringify({ prompt: "a wave at sunrise" }),
			})
			.reply(200, { code: 200, data: { id: "abc123", status: "created" } });

		const res = await call("/api/generate", {
			method: "POST",
			body: JSON.stringify({ prompt: "  a wave at sunrise " }),
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ id: "abc123", status: "created" });
	});

	it("requires a prompt", async () => {
		const res = await call("/api/generate", {
			method: "POST",
			body: JSON.stringify({ prompt: " " }),
		});
		expect(res.status).toBe(400);
	});

	it("passes WaveSpeed errors through", async () => {
		fetchMock
			.get(WAVESPEED)
			.intercept({
				path: "/api/v3/wavespeed-ai/cosmos-predict-2.5/text-to-video",
				method: "POST",
			})
			.reply(402, { code: 402, message: "Insufficient balance" });

		const res = await call("/api/generate", {
			method: "POST",
			body: JSON.stringify({ prompt: "x" }),
		});
		expect(res.status).toBe(402);
		expect(await res.json()).toEqual({ error: "Insufficient balance" });
	});
});

describe("result", () => {
	it("returns the video URL once completed", async () => {
		fetchMock
			.get(WAVESPEED)
			.intercept({ path: "/api/v3/predictions/abc123/result" })
			.reply(200, {
				code: 200,
				data: {
					id: "abc123",
					status: "completed",
					outputs: ["https://cdn.example/video.mp4"],
					error: "",
				},
			});

		const res = await call("/api/result/abc123");
		expect(await res.json()).toMatchObject({
			status: "completed",
			outputs: ["https://cdn.example/video.mp4"],
			error: null,
		});
	});
});
