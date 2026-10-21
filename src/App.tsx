import { useEffect, useRef, useState } from "react";
import { generateImage, localImageUrl, type GenerateOptions } from "./api";

interface HistoryItem {
	id: string;
	prompt: string;
	src: string;
	width: number;
	height: number;
	model: "base" | "sft";
	createdAt: number;
}

const ASPECTS = [
	{ label: "1:1", width: 1024, height: 1024 },
	{ label: "3:4", width: 960, height: 1280 },
	{ label: "2:3", width: 1024, height: 1536 },
	{ label: "9:16", width: 864, height: 1536 },
	{ label: "4:3", width: 1280, height: 960 },
	{ label: "16:9", width: 1536, height: 864 },
];

const IDEAS = [
	"A rain-soaked night market in Taipei, steam rising from food stalls, neon signs reflected in puddles, 35mm film photo",
	"Minimalist travel poster for Kyoto with the words \"KYOTO IN AUTUMN\" in bold serif type, red maple leaves, flat colors",
	"Macro photo of a dew-covered dandelion at sunrise, soft golden backlight, shallow depth of field",
	"Cozy isometric illustration of a tiny bookshop with a cat sleeping in the window, warm evening light",
];

const store = {
	get<T>(key: string, fallback: T): T {
		try {
			const raw = localStorage.getItem(key);
			return raw ? (JSON.parse(raw) as T) : fallback;
		} catch {
			return fallback;
		}
	},
	set(key: string, value: unknown) {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// storage unavailable (private mode); keep working in memory
		}
	},
};

function useStored<T>(key: string, fallback: T) {
	const [value, setValue] = useState<T>(() => store.get(key, fallback));
	useEffect(() => store.set(key, value), [key, value]);
	return [value, setValue] as const;
}

async function shareOrSave(item: HistoryItem) {
	const url = localImageUrl(item.src);
	try {
		const blob = await (await fetch(url)).blob();
		const ext = blob.type.split("/")[1] || "webp";
		const file = new File([blob], `moss-image-${item.id}.${ext}`, { type: blob.type });
		if (navigator.canShare?.({ files: [file] })) {
			await navigator.share({ files: [file], text: item.prompt });
			return;
		}
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = file.name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
	} catch (err) {
		if ((err as Error).name !== "AbortError") window.open(url, "_blank");
	}
}

export default function App() {
	const [prompt, setPrompt] = useStored("moss.prompt", IDEAS[0]);
	const [aspect, setAspect] = useStored("moss.aspect", "3:4");
	const [model, setModel] = useStored<"base" | "sft">("moss.model", "sft");
	const [negative, setNegative] = useStored("moss.negative", "watermark, bad anatomy");
	const [steps, setSteps] = useStored("moss.steps", 50);
	const [cfg, setCfg] = useStored("moss.cfg", 3);
	const [seed, setSeed] = useStored("moss.seed", -1);
	const [token, setToken] = useStored("moss.token", "");
	const [history, setHistory] = useStored<HistoryItem[]>("moss.history", []);

	const [busy, setBusy] = useState(false);
	const [elapsed, setElapsed] = useState(0);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<HistoryItem | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	const current = selected ?? history[0] ?? null;
	const size = ASPECTS.find((a) => a.label === aspect) ?? ASPECTS[0];

	useEffect(() => {
		if (!busy) return;
		const started = Date.now();
		const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
		return () => clearInterval(timer);
	}, [busy]);

	async function onGenerate() {
		if (!prompt.trim() || busy) return;
		const controller = new AbortController();
		abortRef.current = controller;
		setBusy(true);
		setElapsed(0);
		setError("");
		const opts: GenerateOptions = {
			prompt,
			negativePrompt: negative,
			model,
			width: size.width,
			height: size.height,
			steps,
			cfg,
			seed,
		};
		try {
			const result = await generateImage(opts, token, controller.signal);
			const items = result.images.map((src, i) => ({
				id: `${Date.now().toString(36)}${i}`,
				prompt,
				src,
				width: size.width,
				height: size.height,
				model,
				createdAt: Date.now(),
			}));
			setHistory((h) => [...items, ...h].slice(0, 40));
			setSelected(null);
		} catch (err) {
			if ((err as Error).name === "AbortError") return;
			const message = (err as Error).message;
			setError(
				/quota|limit|GPU/i.test(message) && !token
					? `${message} Adding your Hugging Face token in Settings gives you more quota and a higher queue priority.`
					: message,
			);
		} finally {
			setBusy(false);
			abortRef.current = null;
		}
	}

	return (
		<div className="app">
			<header className="topbar">
				<h1 className="brand">
					MOSS<span>Image</span>
				</h1>
				<button
					id="settings-button"
					className="icon-btn"
					onClick={() => setSettingsOpen(true)}
					aria-label="Settings"
				>
					<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
						<path d="M4 7h10M18 7h2M4 17h4M12 17h8" strokeLinecap="round" />
						<circle cx="16" cy="7" r="2" />
						<circle cx="10" cy="17" r="2" />
					</svg>
					{!token && <span className="dot" aria-hidden="true" />}
				</button>
			</header>

			<main className="stage">
				<div
					className="frame"
					style={{
						aspectRatio: `${current?.width ?? size.width} / ${current?.height ?? size.height}`,
					}}
				>
					{current && <img src={current.src} alt={current.prompt} />}
					{!current && !busy && (
						<p className="frame-empty">
							Describe a scene below and tap Generate. Your images will appear here.
						</p>
					)}
					{busy && (
						<div className="developing" role="status">
							<div className="spinner" />
							<p>Generating · {elapsed}s</p>
							<small>Free GPUs can queue for a minute or two.</small>
						</div>
					)}
				</div>
				{current && !busy && (
					<div className="frame-actions">
						<button className="chip" onClick={() => shareOrSave(current)}>
							Save / share
						</button>
						<button className="chip" onClick={() => setPrompt(current.prompt)}>
							Reuse prompt
						</button>
						<span className="meta">
							{current.width}×{current.height} · {current.model.toUpperCase()}
						</span>
					</div>
				)}
				{error && (
					<div className="error" role="alert">
						{error}
					</div>
				)}

				{history.length > 1 && (
					<section className="history" aria-label="Recent images">
						<h2>Recent</h2>
						<div className="strip">
							{history.map((item) => (
								<button
									key={item.id}
									className={`thumb ${current?.id === item.id ? "active" : ""}`}
									onClick={() => setSelected(item)}
									aria-label={item.prompt}
								>
									<img src={item.src} alt="" loading="lazy" />
								</button>
							))}
						</div>
					</section>
				)}
			</main>

			<form
				className="composer"
				onSubmit={(e) => {
					e.preventDefault();
					onGenerate();
				}}
			>
				<textarea
					id="prompt"
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					placeholder="A lighthouse on a cliff at dusk, oil painting…"
					rows={3}
					aria-label="Prompt"
				/>
				<div className="ideas">
					{IDEAS.map((idea) => (
						<button type="button" key={idea} className="idea" onClick={() => setPrompt(idea)}>
							{idea.split(",")[0]}
						</button>
					))}
				</div>
				<div className="row">
					<div className="aspects" role="radiogroup" aria-label="Aspect ratio">
						{ASPECTS.map((a) => (
							<button
								type="button"
								key={a.label}
								role="radio"
								aria-checked={aspect === a.label}
								className={`aspect ${aspect === a.label ? "on" : ""}`}
								onClick={() => setAspect(a.label)}
							>
								<i style={{ aspectRatio: `${a.width} / ${a.height}` }} />
								{a.label}
							</button>
						))}
					</div>
				</div>
				{busy ? (
					<button type="button" className="generate cancel" onClick={() => abortRef.current?.abort()}>
						Cancel
					</button>
				) : (
					<button type="submit" className="generate" disabled={!prompt.trim()}>
						Generate
					</button>
				)}
			</form>

			{settingsOpen && (
				<div className="sheet-backdrop" onClick={() => setSettingsOpen(false)}>
					<div
						className="sheet"
						role="dialog"
						aria-label="Settings"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="sheet-head">
							<h2>Settings</h2>
							<button className="chip" onClick={() => setSettingsOpen(false)}>
								Done
							</button>
						</div>

						<label className="field">
							<span>Hugging Face token</span>
							<input
								id="hf-token"
								type="password"
								value={token}
								onChange={(e) => setToken(e.target.value.trim())}
								placeholder="hf_…"
								autoComplete="off"
							/>
							<small>
								Without a token you share a small anonymous GPU quota. Create a free read token at{" "}
								<a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">
									huggingface.co/settings/tokens
								</a>
								. It's stored only on this device.
							</small>
						</label>

						<div className="field">
							<span>Model</span>
							<div className="segmented">
								{(["sft", "base"] as const).map((m) => (
									<button
										key={m}
										type="button"
										className={model === m ? "on" : ""}
										onClick={() => setModel(m)}
									>
										{m === "sft" ? "SFT (polished)" : "Base"}
									</button>
								))}
							</div>
						</div>

						<label className="field">
							<span>Negative prompt</span>
							<input id="negative" value={negative} onChange={(e) => setNegative(e.target.value)} />
						</label>

						<label className="field">
							<span>
								Steps <b>{steps}</b>
							</span>
							<input
								id="steps"
								type="range"
								min={10}
								max={80}
								value={steps}
								onChange={(e) => setSteps(Number(e.target.value))}
							/>
							<small>Fewer steps are faster and use less quota. 50 is recommended.</small>
						</label>

						<label className="field">
							<span>
								Guidance (CFG) <b>{cfg.toFixed(1)}</b>
							</span>
							<input
								id="cfg"
								type="range"
								min={1}
								max={8}
								step={0.5}
								value={cfg}
								onChange={(e) => setCfg(Number(e.target.value))}
							/>
						</label>

						<label className="field">
							<span>Seed</span>
							<input
								id="seed"
								type="number"
								inputMode="numeric"
								value={seed}
								onChange={(e) => setSeed(Number(e.target.value) || -1)}
							/>
							<small>-1 picks a random seed each time.</small>
						</label>

						{history.length > 0 && (
							<button type="button" className="chip danger" onClick={() => setHistory([])}>
								Clear recent images
							</button>
						)}
						<p className="credit">
							Powered by{" "}
							<a href="https://openmoss.ai/MOSS-Image/" target="_blank" rel="noreferrer">
								MOSS-Image
							</a>{" "}
							from OpenMOSS (Apache-2.0), running on their Hugging Face Space.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
