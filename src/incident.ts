import { DurableObject } from "cloudflare:workers";
import { completeText, type ChatTurn } from "./ai";
import { CHAT, TONE } from "./prompts";

export type Stage = "received" | "timeline" | "questions" | "draft" | "actions" | "complete" | "failed";

export type TimelineEvent = { time: string; event: string; actor: string; kind: string };
export type ActionItem = { title: string; description: string; type: string; priority: string; owner: string };

export type Artifacts = {
	timeline?: TimelineEvent[];
	questions?: string[];
	draft?: string;
	actions?: ActionItem[];
};

export type ChatMessage = { role: "user" | "assistant"; content: string; created_at: string };

export type Snapshot = {
	id: string;
	stage: Stage;
	error: string | null;
	rawTimeline: string;
	artifacts: Artifacts;
	messages: ChatMessage[];
};

const ARTIFACT_KEYS: (keyof Artifacts)[] = ["timeline", "questions", "draft", "actions"];
const HISTORY_LIMIT = 20;

export class IncidentState extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
				CREATE TABLE IF NOT EXISTS messages (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					role TEXT NOT NULL,
					content TEXT NOT NULL,
					created_at TEXT NOT NULL
				);
			`);
		});
	}

	async start(id: string, rawTimeline: string): Promise<void> {
		this.set("id", id);
		this.set("raw", rawTimeline);
		this.set("stage", "received");
		this.set("error", "");
		this.addMessage("user", rawTimeline);
		this.addMessage("assistant", "Thanks. I am reading the notes now. The timeline, clarifying questions, draft and action items will appear here as each step finishes.");
	}

	async setStage(stage: Stage, error?: string): Promise<void> {
		this.set("stage", stage);
		if (error !== undefined) {
			this.set("error", error);
			this.addMessage("assistant", `Something went wrong while working on this incident: ${error}`);
		}
	}

	async saveArtifact(kind: keyof Artifacts, value: unknown, note: string): Promise<void> {
		this.set(`artifact:${kind}`, JSON.stringify(value));
		this.addMessage("assistant", note);
	}

	async getContext(): Promise<{ rawTimeline: string; artifacts: Artifacts }> {
		return { rawTimeline: this.get("raw") ?? "", artifacts: this.artifacts() };
	}

	async snapshot(): Promise<Snapshot> {
		return {
			id: this.get("id") ?? "",
			stage: (this.get("stage") as Stage) ?? "received",
			error: this.get("error") || null,
			rawTimeline: this.get("raw") ?? "",
			artifacts: this.artifacts(),
			messages: this.messages(),
		};
	}

	async chat(userMessage: string): Promise<string> {
		this.addMessage("user", userMessage);
		const history = this.messages().slice(-HISTORY_LIMIT);
		const turns: ChatTurn[] = [
			{ role: "system", content: `${TONE}\n\n${CHAT}\n\n${this.contextBlock()}` },
			...history.map((m) => ({ role: m.role, content: m.content })),
		];
		const reply = await completeText(this.env.AI, turns, 1200);
		this.addMessage("assistant", reply);
		return reply;
	}

	private contextBlock(): string {
		const a = this.artifacts();
		return [
			`## Raw incident notes\n${this.get("raw") ?? ""}`,
			`## Extracted timeline\n${JSON.stringify(a.timeline ?? [], null, 1)}`,
			`## Clarifying questions\n${(a.questions ?? []).map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
			`## Postmortem draft\n${a.draft ?? "(not written yet)"}`,
			`## Proposed action items\n${JSON.stringify(a.actions ?? [], null, 1)}`,
		].join("\n\n");
	}

	private artifacts(): Artifacts {
		const out: Artifacts = {};
		for (const key of ARTIFACT_KEYS) {
			const raw = this.get(`artifact:${key}`);
			if (raw) out[key] = JSON.parse(raw);
		}
		return out;
	}

	private messages(): ChatMessage[] {
		return this.ctx.storage.sql
			.exec<ChatMessage>("SELECT role, content, created_at FROM messages ORDER BY id")
			.toArray();
	}

	private addMessage(role: ChatMessage["role"], content: string): void {
		this.ctx.storage.sql.exec(
			"INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)",
			role,
			content,
			new Date().toISOString(),
		);
	}

	private get(key: string): string | undefined {
		const row = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
		return row?.value;
	}

	private set(key: string, value: string): void {
		this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
	}
}
