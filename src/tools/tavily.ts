/**
 * Tavily web search tool.
 *
 * Registered only when TAVILY_API_KEY is set.
 */

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface TavilyResponse {
	answer?: string;
	results?: Array<{ title: string; url: string; content: string }>;
}

function textResult(text: string): { content: { type: "text"; text: string }[]; details: unknown } {
	return { content: [{ type: "text", text }], details: {} };
}

export function createTavilyTools(apiKey: string, baseUrl: string): ToolDefinition[] {
	const search = defineTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web with Tavily. Returns a short generated answer followed by ranked results (title, URL, snippet). " +
			"Use for current events, documentation lookups, and facts outside the model's knowledge.",
		parameters: Type.Object({
			query: Type.String({ description: "The search query." }),
			max_results: Type.Optional(
				Type.Integer({ minimum: 1, maximum: 20, description: "Number of results to return (default 5)." }),
			),
			search_depth: Type.Optional(
				Type.Union([Type.Literal("basic"), Type.Literal("advanced")], {
					description: "Search depth; 'advanced' is slower but more thorough (default 'basic').",
				}),
			),
		}),
		execute: async (_id, { query, max_results, search_depth }, signal) => {
			try {
				const resp = await fetch(`${baseUrl}/search`, {
					method: "POST",
					headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
					body: JSON.stringify({
						query,
						max_results: max_results ?? 5,
						search_depth: search_depth ?? "basic",
						include_answer: true,
					}),
					signal,
				});
				if (!resp.ok) {
					return textResult(`Tavily error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
				}
				const data = (await resp.json()) as TavilyResponse;
				const lines: string[] = [];
				if (data.answer) lines.push(`Answer: ${data.answer}\n`);
				for (const r of data.results ?? []) {
					lines.push(`- ${r.title}\n  ${r.url}\n  ${r.content}`);
				}
				return textResult(lines.join("\n") || "No results found.");
			} catch (err) {
				return textResult(`Tavily request failed: ${(err as Error).message}`);
			}
		},
	});

	return [search];
}
