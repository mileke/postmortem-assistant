export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

type AiResult = { response?: unknown };

export async function completeText(ai: Ai, messages: ChatTurn[], maxTokens = 1500): Promise<string> {
	const result = (await ai.run(MODEL, {
		messages,
		max_tokens: maxTokens,
		temperature: 0.2,
	})) as AiResult;
	const text = result.response;
	return typeof text === "string" ? text.trim() : JSON.stringify(text);
}

export async function completeJson<T>(ai: Ai, messages: ChatTurn[], schema: object, maxTokens = 1500): Promise<T> {
	const result = (await ai.run(MODEL, {
		messages,
		max_tokens: maxTokens,
		temperature: 0.1,
		response_format: { type: "json_schema", json_schema: schema },
	})) as AiResult;
	return parseJson<T>(result.response);
}

export async function completePromptedJson<T>(ai: Ai, messages: ChatTurn[], schema: object, maxTokens = 1500): Promise<T> {
	const contract = `Reply with a single JSON object and nothing else, no prose and no code fence. It must match this JSON Schema:\n${JSON.stringify(schema)}`;
	const [system, ...rest] = messages;
	const withContract: ChatTurn[] =
		system?.role === "system"
			? [{ role: "system", content: `${system.content}\n\n${contract}` }, ...rest]
			: [{ role: "system", content: contract }, ...messages];
	const result = (await ai.run(MODEL, {
		messages: withContract,
		max_tokens: maxTokens,
		temperature: 0.1,
	})) as AiResult;
	return parseJson<T>(result.response);
}

function parseJson<T>(body: unknown): T {
	if (typeof body !== "string") return body as T;
	const trimmed = body.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
	const candidate = fenced ? fenced[1] : trimmed;
	try {
		return JSON.parse(candidate) as T;
	} catch {
		const start = candidate.indexOf("{");
		const end = candidate.lastIndexOf("}");
		if (start === -1 || end <= start) throw new Error("Model reply was not JSON");
		return JSON.parse(candidate.slice(start, end + 1)) as T;
	}
}
