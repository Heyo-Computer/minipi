/**
 * Assembles the custom tool set from configuration.
 *
 * Each integration is opt-in: postgres tools require DATABASE_URL, web_search
 * requires TAVILY_API_KEY, and MCP tools require MCP_SERVERS.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { config } from "../config.ts";
import { createMcpTools } from "./mcp.ts";
import { createPostgresTools } from "./postgres.ts";
import { createTavilyTools } from "./tavily.ts";

export async function buildCustomTools(): Promise<ToolDefinition[]> {
	const tools: ToolDefinition[] = [];

	if (config.databaseUrl) {
		tools.push(...createPostgresTools(config.databaseUrl));
	}
	if (config.tavilyApiKey) {
		tools.push(...createTavilyTools(config.tavilyApiKey, config.tavilyBaseUrl));
	}
	if (config.mcpServers.length > 0) {
		tools.push(...(await createMcpTools(config.mcpServers)));
	}

	return tools;
}
