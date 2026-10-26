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
	const body = result.response;
	if (typeof body === "string") {
		return JSON.parse(stripFences(body)) as T;
	}
	return body as T;
}

function stripFences(text: string): string {
	const trimmed = text.trim();
	const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
	return match ? match[1] : trimmed;
}
