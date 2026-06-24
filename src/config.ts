/**
 * Configuration for minipi, loaded from a `.env` file (or the real environment).
 *
 * All tool integrations are optional: a family of tools is only registered when
 * its configuration is present. See `.env.example` for the full set of keys.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load `.env` from the current working directory if present. Real environment
// variables still take precedence for anything already set.
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
	process.loadEnvFile(envPath);
}

/** A stdio-based MCP server to connect to. */
export interface McpServerConfig {
	/** Short name; used to namespace the server's tools (e.g. `fs__read_file`). */
	name: string;
	/** Executable to spawn (e.g. `npx`). */
	command: string;
	/** Arguments passed to the command. */
	args?: string[];
	/** Extra environment variables for the spawned server. */
	env?: Record<string, string>;
}

function parseMcpServers(raw: string | undefined): McpServerConfig[] {
	if (!raw?.trim()) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`MCP_SERVERS is not valid JSON: ${(err as Error).message}`);
	}
	if (!Array.isArray(parsed)) {
		throw new Error("MCP_SERVERS must be a JSON array of { name, command, args?, env? } objects.");
	}
	return parsed.map((entry, i) => {
		const server = entry as Partial<McpServerConfig>;
		if (!server.name || !server.command) {
			throw new Error(`MCP_SERVERS[${i}] must have both "name" and "command".`);
		}
		return { name: server.name, command: server.command, args: server.args, env: server.env };
	});
}

export const config = {
	/** Ollama model tag. Must match a tag from `ollama list`. */
	modelId: process.env.MINIPI_MODEL ?? "LiquidAI/lfm2.5-1.2b-instruct",
	/** Ollama's OpenAI-compatible endpoint. */
	ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
	/** Model context window in tokens. Drives the context-usage % and /tidy hint. Default 128000. */
	contextWindow: Number(process.env.MINIPI_CONTEXT_WINDOW ?? 128000),
	/** Max tokens the model may generate per response. Default 8192. */
	maxTokens: Number(process.env.MINIPI_MAX_TOKENS ?? 8192),
	/** PostgreSQL connection string. Enables the postgres tools when set. */
	databaseUrl: process.env.DATABASE_URL,
	/**
	 * SSL/TLS mode for Postgres:
	 *   - "disable" / unset → no TLS (local dev)
	 *   - "require" / "no-verify" → encrypt but don't verify the server cert
	 *     (the common setting for managed cloud DBs: Supabase, Neon, RDS, Heroku…)
	 *   - "verify" → encrypt and verify against system CAs or DATABASE_CA_CERT
	 */
	databaseSsl: process.env.DATABASE_SSL,
	/** Optional path to a CA certificate (PEM) used to verify the Postgres server. */
	databaseCaCert: process.env.DATABASE_CA_CERT,
	/** Tavily API key. Enables the web_search tool when set. */
	tavilyApiKey: process.env.TAVILY_API_KEY,
	/** Tavily API base URL. */
	tavilyBaseUrl: process.env.TAVILY_BASE_URL ?? "https://api.tavily.com",
	/** MCP stdio servers to connect to. Enables their tools when non-empty. */
	mcpServers: parseMcpServers(process.env.MCP_SERVERS),
	/** Long-term memory: on by default, disabled when MINIPI_MEMORY is off/0/false. */
	memoryEnabled: !["off", "0", "false"].includes((process.env.MINIPI_MEMORY ?? "").trim().toLowerCase()),
	/** Directory holding the memory file (MEMORY.md). Defaults to <cwd>/.minipi/memory. */
	memoryDir: process.env.MINIPI_MEMORY_DIR ?? resolve(process.cwd(), ".minipi/memory"),
	/**
	 * Path to the editable system-prompt file. Defaults to the bundled
	 * `prompts/system.md` (resolved relative to source, so it works from any cwd).
	 * If the file is missing, the SDK's built-in default prompt is used.
	 */
	systemPromptPath:
		process.env.MINIPI_SYSTEM_PROMPT_PATH ?? fileURLToPath(new URL("../prompts/system.md", import.meta.url)),
	/** Context-usage percentage at which the TUI suggests /tidy. Default 75. */
	contextWarnPercent: Number(process.env.MINIPI_CONTEXT_WARN_PCT ?? 75),
	/** Resume the most recent conversation thread on start (RPC) instead of beginning a fresh one. */
	resume: ["1", "true", "on", "yes"].includes((process.env.MINIPI_RESUME ?? "").trim().toLowerCase()),
};
