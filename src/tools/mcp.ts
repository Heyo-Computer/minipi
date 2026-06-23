/**
 * MCP (Model Context Protocol) integration.
 *
 * Connects to each configured stdio MCP server, lists its tools, and adapts
 * every one into a Pi tool. A remote tool's JSON Schema `inputSchema` is passed
 * straight through as the Pi tool's `parameters` — Pi's validator (TypeBox
 * `Compile`) accepts plain JSON Schema, so no schema conversion is required.
 *
 * Tools are namespaced as `<server>__<tool>` to avoid collisions.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { McpServerConfig } from "../config.ts";

interface McpContentItem {
	type: string;
	text?: string;
}

function textResult(text: string): { content: { type: "text"; text: string }[]; details: unknown } {
	return { content: [{ type: "text", text }], details: {} };
}

export async function createMcpTools(servers: McpServerConfig[]): Promise<ToolDefinition[]> {
	const tools: ToolDefinition[] = [];

	for (const server of servers) {
		try {
			const transport = new StdioClientTransport({
				command: server.command,
				args: server.args ?? [],
				env: { ...(process.env as Record<string, string>), ...(server.env ?? {}) },
			});
			const client = new Client({ name: "minipi", version: "0.1.0" });
			await client.connect(transport);
			process.on("exit", () => {
				void client.close();
			});

			const { tools: mcpTools } = await client.listTools();
			for (const tool of mcpTools) {
				const name = `${server.name}__${tool.name}`.replace(/[^a-zA-Z0-9_]/g, "_");
				tools.push(
					defineTool({
						name,
						label: `MCP: ${server.name}/${tool.name}`,
						description: tool.description ?? `MCP tool "${tool.name}" from server "${server.name}".`,
						// MCP inputSchema is a JSON Schema object; Pi validates it directly.
						parameters: (tool.inputSchema ?? { type: "object", properties: {} }) as unknown as TSchema,
						execute: async (_id, params, signal) => {
							try {
								const result = await client.callTool(
									{ name: tool.name, arguments: params as Record<string, unknown> },
									undefined,
									{ signal },
								);
								const items = (result.content as McpContentItem[] | undefined) ?? [];
								const text = items
									.map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type} content]`))
									.join("\n");
								return textResult(text || "(no output)");
							} catch (err) {
								return textResult(`MCP tool error: ${(err as Error).message}`);
							}
						},
					}),
				);
			}
			console.error(`[minipi] MCP "${server.name}": connected, ${mcpTools.length} tool(s)`);
		} catch (err) {
			// A failed server must not take down the whole harness.
			console.error(`[minipi] MCP "${server.name}": failed to connect — ${(err as Error).message}`);
		}
	}

	return tools;
}
