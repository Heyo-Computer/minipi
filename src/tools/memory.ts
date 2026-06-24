/**
 * Lightweight memory: durable facts the agent can save and recall across
 * sessions, stored as a single plain-markdown file.
 *
 * Enabled by default (disable with MINIPI_MEMORY=off). Two halves:
 *   - three tools (`memory_write`, `memory_read`, `memory_search`) the model
 *     can call directly;
 *   - `readContext()`, which the runtime appends to the system prompt on each
 *     session creation so the model recalls memory *without* having to call a
 *     tool — see `appendSystemPromptOverride` wiring in `src/runtime.ts`.
 *
 * No embeddings, no external `qmd` binary, no daily logs: just an append-only
 * `MEMORY.md` and case-insensitive substring search.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Max characters of memory injected into the system prompt (keeps the small model's context bounded). */
const MAX_CONTEXT_CHARS = 4000;

export interface MemoryStore {
	/** The memory tools to register as custom tools. */
	tools: ToolDefinition[];
	/** Build the `## Memory` block to append to the system prompt, or "" when empty. */
	readContext(): string;
}

function textResult(text: string): { content: { type: "text"; text: string }[]; details: unknown } {
	return { content: [{ type: "text", text }], details: {} };
}

/** Today's date as YYYY-MM-DD, for stamping entries. */
function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Create a memory store backed by `<dir>/MEMORY.md`.
 *
 * The directory and file are created lazily on the first write, so enabling
 * memory never touches the working tree until the agent actually saves a fact.
 */
export function createMemoryStore({ dir }: { dir: string }): MemoryStore {
	const file = join(dir, "MEMORY.md");

	function readAll(): string {
		if (!existsSync(file)) return "";
		return readFileSync(file, "utf8");
	}

	function appendEntry(content: string, tags?: string[]): void {
		mkdirSync(dir, { recursive: true });
		const header = existsSync(file) ? "" : "# Memory\n\n";
		const tagSuffix = tags?.length ? ` ${tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}` : "";
		appendFileSync(file, `${header}- [${today()}] ${content.trim()}${tagSuffix}\n`, "utf8");
	}

	function search(query: string): string[] {
		const needle = query.toLowerCase();
		return readAll()
			.split("\n")
			.filter((line) => line.toLowerCase().includes(needle));
	}

	const write = defineTool({
		name: "memory_write",
		label: "Memory Write",
		description:
			"Save a durable fact, decision, or preference to long-term memory so it survives across sessions. " +
			"Memory is injected into your context automatically at the start of each session, so write things worth " +
			'remembering later (e.g. "this repo uses bun, never npm"). One concise fact per call.',
		promptSnippet: "Save durable facts, decisions, and preferences across sessions",
		promptGuidelines: [
			'When the user asks you to remember something, or states a lasting preference, decision, or fact, call memory_write immediately to persist it.',
		],
		parameters: Type.Object({
			content: Type.String({ description: "The fact to remember. Keep it short and self-contained." }),
			tags: Type.Optional(
				Type.Array(Type.String(), {
					description: 'Optional keywords to aid later search, e.g. ["decision", "tooling"].',
				}),
			),
		}),
		execute: async (_id, { content, tags }) => {
			try {
				appendEntry(content, tags);
				return textResult("Saved to memory.");
			} catch (err) {
				return textResult(`Failed to write memory: ${(err as Error).message}`);
			}
		},
	});

	const read = defineTool({
		name: "memory_read",
		label: "Memory Read",
		description:
			"Read the full contents of long-term memory. Recent memory is already injected into your context; use " +
			"this to see everything, including older entries that may have been truncated from the injected snapshot.",
		promptSnippet: "Read the full long-term memory file",
		parameters: Type.Object({}),
		execute: async () => {
			const all = readAll().trim();
			return textResult(all || "Memory is empty. Use memory_write to save your first fact.");
		},
	});

	const searchTool = defineTool({
		name: "memory_search",
		label: "Memory Search",
		description:
			"Search long-term memory for lines containing a keyword (case-insensitive substring match). " +
			"Use this to recall older facts not present in the injected snapshot.",
		promptSnippet: "Search long-term memory by keyword",
		parameters: Type.Object({
			query: Type.String({ description: "Keyword or phrase to look for." }),
		}),
		execute: async (_id, { query }) => {
			const matches = search(query);
			return textResult(matches.length ? matches.join("\n") : `No memory entries match "${query}".`);
		},
	});

	function readContext(): string {
		// Drop the file's own "# Memory" title; this block supplies its own header.
		const all = readAll().replace(/^#\s+Memory\s*/i, "").trim();
		if (!all) return "";

		let body = all;
		let truncated = false;
		if (body.length > MAX_CONTEXT_CHARS) {
			// Keep the most recent entries (tail); drop any partial leading line.
			body = body.slice(body.length - MAX_CONTEXT_CHARS);
			const firstNewline = body.indexOf("\n");
			if (firstNewline !== -1) body = body.slice(firstNewline + 1);
			truncated = true;
		}

		const lines = [
			"## Memory",
			"Durable facts saved from earlier sessions. Use the memory_write tool to add to this.",
		];
		if (truncated) lines.push("(Older entries truncated — use memory_search / memory_read for the full history.)");
		lines.push("", body);
		return lines.join("\n");
	}

	return { tools: [write, read, searchTool], readContext };
}
