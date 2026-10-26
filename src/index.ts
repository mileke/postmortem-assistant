export { IncidentState } from "./incident";
export { PostmortemWorkflow } from "./workflow";

const MAX_NOTES_CHARS = 20_000;
const MAX_CHAT_CHARS = 4_000;

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (!url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}
		try {
			return await route(request, env, url);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return json({ error: message }, 500);
		}
	},
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL): Promise<Response> {
	const parts = url.pathname.split("/").filter(Boolean);

	if (request.method === "POST" && parts.length === 2 && parts[1] === "incidents") {
		const body = await readJson<{ timeline?: string }>(request);
		const timeline = (body.timeline ?? "").trim();
		if (timeline.length < 20) return json({ error: "Paste an incident timeline of at least 20 characters." }, 400);
		if (timeline.length > MAX_NOTES_CHARS) return json({ error: `Notes are limited to ${MAX_NOTES_CHARS} characters.` }, 400);

		const id = crypto.randomUUID();
		await env.INCIDENT.getByName(id).start(id, timeline);
		await env.POSTMORTEM_WORKFLOW.create({ id, params: { incidentId: id } });
		return json({ id }, 201);
	}

	if (parts.length >= 3 && parts[1] === "incidents") {
		const id = parts[2];
		if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "Unknown incident." }, 404);
		const incident = env.INCIDENT.getByName(id);

		if (request.method === "GET" && parts.length === 3) {
			const snapshot = await incident.snapshot();
			if (!snapshot.id) return json({ error: "Unknown incident." }, 404);
			const workflow = await workflowStatus(env, id);
			return json({ ...snapshot, workflow });
		}

		if (request.method === "POST" && parts.length === 4 && parts[3] === "chat") {
			const body = await readJson<{ message?: string }>(request);
			const message = (body.message ?? "").trim();
			if (!message) return json({ error: "Message is empty." }, 400);
			if (message.length > MAX_CHAT_CHARS) return json({ error: `Messages are limited to ${MAX_CHAT_CHARS} characters.` }, 400);
			const snapshot = await incident.snapshot();
			if (!snapshot.id) return json({ error: "Unknown incident." }, 404);
			const reply = await incident.chat(message);
			return json({ reply });
		}
	}

	return json({ error: "Not found." }, 404);
}

async function workflowStatus(env: Env, id: string): Promise<string> {
	try {
		const instance = await env.POSTMORTEM_WORKFLOW.get(id);
		return (await instance.status()).status;
	} catch {
		return "unknown";
	}
}

async function readJson<T>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		return {} as T;
	}
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
