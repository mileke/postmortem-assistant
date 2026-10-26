import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from "cloudflare:workers";
import { completeJson, completeText, type ChatTurn } from "./ai";
import type { ActionItem, TimelineEvent } from "./incident";
import { ACTION_ITEMS, CLARIFYING_QUESTIONS, DRAFT_POSTMORTEM, EXTRACT_TIMELINE, TONE } from "./prompts";

export type PostmortemParams = { incidentId: string };

const RETRIES: WorkflowStepConfig = { retries: { limit: 2, delay: "10 seconds", backoff: "linear" }, timeout: "3 minutes" };

const TIMELINE_SCHEMA = {
	type: "object",
	properties: {
		events: {
			type: "array",
			items: {
				type: "object",
				properties: {
					time: { type: "string" },
					event: { type: "string" },
					actor: { type: "string" },
					kind: { type: "string", enum: ["detection", "escalation", "investigation", "mitigation", "resolution", "communication", "other"] },
				},
				required: ["time", "event", "actor", "kind"],
			},
		},
	},
	required: ["events"],
};

const QUESTIONS_SCHEMA = {
	type: "object",
	properties: { questions: { type: "array", items: { type: "string" } } },
	required: ["questions"],
};

const ACTIONS_SCHEMA = {
	type: "object",
	properties: {
		items: {
			type: "array",
			items: {
				type: "object",
				properties: {
					title: { type: "string" },
					description: { type: "string" },
					type: { type: "string", enum: ["prevent", "detect", "mitigate", "process"] },
					priority: { type: "string", enum: ["P1", "P2", "P3"] },
					owner: { type: "string" },
				},
				required: ["title", "description", "type", "priority", "owner"],
			},
		},
	},
	required: ["items"],
};

export class PostmortemWorkflow extends WorkflowEntrypoint<Env, PostmortemParams> {
	async run(event: WorkflowEvent<PostmortemParams>, step: WorkflowStep) {
		const id = event.payload.incidentId;
		const incident = () => this.env.INCIDENT.getByName(id);
		const ai = this.env.AI;

		try {
			const raw = await step.do<string>("load incident notes", async () => {
				const ctx = await incident().getContext();
				await incident().setStage("timeline");
				return ctx.rawTimeline;
			});

			const timeline = await step.do<TimelineEvent[]>("extract timeline", RETRIES, async () => {
				const result = await completeJson<{ events: TimelineEvent[] }>(ai, prompt(EXTRACT_TIMELINE, raw), TIMELINE_SCHEMA);
				await incident().saveArtifact("timeline", result.events, renderTimeline(result.events));
				await incident().setStage("questions");
				return result.events;
			});

			const questions = await step.do<string[]>("generate clarifying questions", RETRIES, async () => {
				const input = `${raw}\n\n## Extracted timeline\n${JSON.stringify(timeline, null, 1)}`;
				const result = await completeJson<{ questions: string[] }>(ai, prompt(CLARIFYING_QUESTIONS, input), QUESTIONS_SCHEMA);
				await incident().saveArtifact("questions", result.questions, renderQuestions(result.questions));
				await incident().setStage("draft");
				return result.questions;
			});

			const draft = await step.do<string>("draft postmortem", RETRIES, async () => {
				const input = [
					raw,
					`## Extracted timeline\n${JSON.stringify(timeline, null, 1)}`,
					`## Open clarifying questions\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
				].join("\n\n");
				const text = await completeText(ai, prompt(DRAFT_POSTMORTEM, input), 2000);
				await incident().saveArtifact("draft", text, `Here is the first draft.\n\n${text}`);
				await incident().setStage("actions");
				return text;
			});

			await step.do("propose action items", RETRIES, async () => {
				const input = `${raw}\n\n## Postmortem draft\n${draft}`;
				const result = await completeJson<{ items: ActionItem[] }>(ai, prompt(ACTION_ITEMS, input), ACTIONS_SCHEMA);
				await incident().saveArtifact("actions", result.items, renderActions(result.items));
				await incident().setStage("complete");
			});

			return { incidentId: id, status: "complete" };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await step.do("record failure", async () => {
				await incident().setStage("failed", message);
			});
			throw err;
		}
	}
}

function prompt(instruction: string, notes: string): ChatTurn[] {
	return [
		{ role: "system", content: `${TONE}\n\n${instruction}` },
		{ role: "user", content: `## Raw incident notes\n${notes}` },
	];
}

function renderTimeline(events: TimelineEvent[]): string {
	const lines = events.map((e) => `- **${e.time}** (${e.kind}) ${e.event}${e.actor && e.actor !== "unknown" ? ` [${e.actor}]` : ""}`);
	return `## Extracted timeline\n${lines.join("\n")}`;
}

function renderQuestions(questions: string[]): string {
	const lines = questions.map((q, i) => `${i + 1}. ${q}`);
	return `## Clarifying questions\nAnswer any of these in the chat and I will fold the answer into the draft.\n\n${lines.join("\n")}`;
}

function renderActions(items: ActionItem[]): string {
	const lines = items.map((a) => `- **${a.priority} ${a.title}** (${a.type}, owner: ${a.owner}) ${a.description}`);
	return `## Proposed action items\n${lines.join("\n")}\n\nThat completes the first pass. Ask for changes or answer the questions above to refine the draft.`;
}
