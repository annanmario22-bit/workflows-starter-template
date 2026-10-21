import { useCallback, useEffect, useRef, useState } from "react";

type Job = {
	id: string;
	prompt: string;
	status: string;
	outputs: string[];
	error: string | null;
	createdAt: number;
};

const PASSWORD_KEY = "cosmos.password";
const JOBS_KEY = "cosmos.jobs";
const POLL_MS = 4000;
const FAILED = ["failed", "cancelled", "timeout", "deleted"];

function load<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function save(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage full or blocked; the app still works for this session
	}
}

const isDone = (job: Job) => job.status === "completed" || FAILED.includes(job.status);

async function api<T>(
	path: string,
	password: string,
	init?: RequestInit,
): Promise<T> {
	const res = await fetch(path, {
		...init,
		headers: {
			Authorization: `Bearer ${password}`,
			"Content-Type": "application/json",
		},
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(data.error || `Request failed (${res.status})`);
		(err as Error & { status?: number }).status = res.status;
		throw err;
	}
	return data as T;
}

function PasswordScreen({ onUnlock }: { onUnlock: (pw: string) => void }) {
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await api("/api/auth", value, { method: "POST" });
			onUnlock(value);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<form onSubmit={submit} className="flex flex-col gap-3 mt-16">
			<h2 className="text-xl font-semibold">Enter password</h2>
			<p className="text-sm text-neutral-500 dark:text-neutral-400">
				This is the ACCESS_PASSWORD you set on the server.
			</p>
			<input
				type="password"
				autoComplete="current-password"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				className="input"
				placeholder="Password"
			/>
			{error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
			<button type="submit" disabled={!value || busy} className="btn">
				{busy ? "Checking…" : "Unlock"}
			</button>
		</form>
	);
}

function JobCard({ job, onRemove }: { job: Job; onRemove: () => void }) {
	const video = job.outputs[0];
	const failed = FAILED.includes(job.status);

	return (
		<li className="card">
			<p className="text-sm whitespace-pre-wrap break-words">{job.prompt}</p>

			{video ? (
				<video
					src={video}
					controls
					playsInline
					loop
					className="w-full rounded-lg mt-3 bg-black"
				/>
			) : (
				<div className="mt-3 rounded-lg aspect-video flex items-center justify-center bg-neutral-100 dark:bg-neutral-800 text-sm text-neutral-500 dark:text-neutral-400">
					{failed ? (
						<span className="text-red-600 dark:text-red-400 px-4 text-center">
							{job.status}: {job.error || "no details"}
						</span>
					) : (
						<span className="flex items-center gap-2">
							<span className="spinner" /> Generating ({job.status})…
						</span>
					)}
				</div>
			)}

			<div className="flex items-center justify-between mt-3 text-xs text-neutral-500 dark:text-neutral-400">
				<span>{new Date(job.createdAt).toLocaleString()}</span>
				<div className="flex gap-4">
					{video && (
						<a href={video} target="_blank" rel="noopener noreferrer" download className="link">
							Open / save
						</a>
					)}
					<button onClick={onRemove} className="link">
						Remove
					</button>
				</div>
			</div>
		</li>
	);
}

function App() {
	const [password, setPassword] = useState<string | null>(() =>
		load<string | null>(PASSWORD_KEY, null),
	);
	const [jobs, setJobs] = useState<Job[]>(() => load<Job[]>(JOBS_KEY, []));
	const [prompt, setPrompt] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const jobsRef = useRef(jobs);
	jobsRef.current = jobs;

	useEffect(() => save(JOBS_KEY, jobs), [jobs]);

	const unlock = (pw: string) => {
		save(PASSWORD_KEY, pw);
		setPassword(pw);
	};

	const lock = useCallback(() => {
		try {
			localStorage.removeItem(PASSWORD_KEY);
		} catch {
			// Ignore
		}
		setPassword(null);
	}, []);

	const updateJob = (id: string, patch: Partial<Job>) =>
		setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...patch } : j)));

	// Poll every unfinished job until it completes or fails
	useEffect(() => {
		if (!password) return;
		let stopped = false;

		const tick = async () => {
			const pending = jobsRef.current.filter((j) => !isDone(j));
			await Promise.all(
				pending.map(async (job) => {
					try {
						const r = await api<Omit<Job, "prompt" | "createdAt">>(
							`/api/result/${job.id}`,
							password,
						);
						if (!stopped) {
							updateJob(job.id, { status: r.status, outputs: r.outputs, error: r.error });
						}
					} catch (err) {
						if ((err as { status?: number }).status === 401) lock();
						// Other errors (network, 429, 5xx) are retried on the next tick
					}
				}),
			);
		};

		tick();
		const timer = setInterval(tick, POLL_MS);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	}, [password, lock]);

	const generate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!password || !prompt.trim()) return;
		setSubmitting(true);
		setError(null);
		try {
			const r = await api<Omit<Job, "prompt" | "createdAt">>("/api/generate", password, {
				method: "POST",
				body: JSON.stringify({ prompt }),
			});
			setJobs((list) => [
				{ ...r, prompt: prompt.trim(), createdAt: Date.now() },
				...list,
			]);
			setPrompt("");
		} catch (err) {
			if ((err as { status?: number }).status === 401) lock();
			setError((err as Error).message);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
			<div className="max-w-xl mx-auto px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
				<header className="flex items-center justify-between py-3">
					<h1 className="text-lg font-semibold">Cosmos Predict 2.5</h1>
					{password && (
						<button onClick={lock} className="link text-sm">
							Lock
						</button>
					)}
				</header>

				{!password ? (
					<PasswordScreen onUnlock={unlock} />
				) : (
					<>
						<form onSubmit={generate} className="flex flex-col gap-3">
							<textarea
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								rows={5}
								maxLength={4000}
								placeholder="Describe the scene, action and visual style…"
								className="input resize-y"
							/>
							{error && (
								<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
							)}
							<button
								type="submit"
								disabled={!prompt.trim() || submitting}
								className="btn"
							>
								{submitting ? "Submitting…" : "Generate video"}
							</button>
							<p className="text-xs text-neutral-500 dark:text-neutral-400 text-center">
								Each video is billed to your WaveSpeed account (about $0.25).
							</p>
						</form>

						<ul className="flex flex-col gap-4 mt-6">
							{jobs.map((job) => (
								<JobCard
									key={job.id}
									job={job}
									onRemove={() =>
										setJobs((list) => list.filter((j) => j.id !== job.id))
									}
								/>
							))}
						</ul>
					</>
				)}
			</div>
		</div>
	);
}

export default App;
