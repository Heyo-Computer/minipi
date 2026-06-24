/**
 * Shared agent runtime for minipi.
 *
 * Builds an AgentSessionRuntime wired to a local Ollama server running the
 * lfm2.5 model, with the built-in bash / read / write tools plus the optional
 * postgres, web-search, and MCP tools configured via `.env`. Both entry points
 * (the TUI in `tui.ts` and the JSON-RPC transport in `rpc.ts`) consume the
 * runtime this module produces.
 */

import {
	type AgentSessionRuntime,
	AuthStorage,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	ModelRegistry,
	type SessionManager,
} from "@earendil-works/pi-coding-agent";
import { config } from "./config.ts";
import { createContextMonitor } from "./extensions/context-monitor.ts";
import { loadSystemPrompt } from "./prompt.ts";
import { buildCustomTools } from "./tools/index.ts";
import { createMemoryStore } from "./tools/memory.ts";

/** Provider id used to register the local Ollama endpoint. */
export const PROVIDER = "ollama";

/** Ollama model tag (from MINIPI_MODEL). Must match a tag from `ollama list`. */
export const MODEL_ID = config.modelId;

/** Ollama's OpenAI-compatible endpoint. */
export const BASE_URL = config.ollamaBaseUrl;

/** Built-in tool set: bash + file read/write. */
export const BUILTIN_TOOLS = ["read", "write", "bash"];

/**
 * Register the local Ollama provider on a fresh in-memory registry.
 *
 * Ollama ignores the API key on its OpenAI-compatible endpoint, but the SDK
 * requires a non-empty key to resolve the provider, so we set a dummy one.
 */
function buildRegistry(): { authStorage: AuthStorage; modelRegistry: ModelRegistry } {
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(PROVIDER, "ollama-local");

	const modelRegistry = ModelRegistry.inMemory(authStorage);
	modelRegistry.registerProvider(PROVIDER, {
		name: "Ollama (local)",
		baseUrl: BASE_URL,
		apiKey: "ollama-local",
		api: "openai-completions",
		models: [
			{
				id: MODEL_ID,
				name: `LFM2.5 (${MODEL_ID})`,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: config.contextWindow,
				maxTokens: config.maxTokens,
			},
		],
	});

	return { authStorage, modelRegistry };
}

/**
 * Build an AgentSessionRuntime bound to the Ollama lfm2.5 model and the
 * configured tool set. The auth storage, model registry, and custom tools are
 * created once and closed over by the factory so they survive session
 * replacement (/new, /resume, fork, import) — in particular, MCP servers and
 * the Postgres pool are connected a single time for the process lifetime.
 */
export async function buildRuntime(sessionManager: SessionManager): Promise<AgentSessionRuntime> {
	const { authStorage, modelRegistry } = buildRegistry();

	// Memory is built once (like the other custom tools) so the file location is
	// fixed for the process; its snapshot is re-read per session below.
	const memory = config.memoryEnabled ? createMemoryStore({ dir: config.memoryDir }) : null;
	const customTools = [...(await buildCustomTools()), ...(memory?.tools ?? [])];
	const toolNames = [...BUILTIN_TOOLS, ...customTools.map((t) => t.name)];

	// The editable system prompt and the context-monitor extension are fixed for
	// the process; both are wired through the resource loader below.
	const systemPrompt = loadSystemPrompt(config.systemPromptPath);
	const extensionFactories = [createContextMonitor({ warnPercent: config.contextWarnPercent })];

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd,
			authStorage,
			modelRegistry,
			resourceLoaderOptions: {
				// Replace the base prompt with our editable file (when present);
				// the default SDK prompt is used when it returns undefined.
				...(systemPrompt ? { systemPromptOverride: () => systemPrompt } : {}),
				// Re-read memory on each session (re)creation so the latest facts are
				// injected — additive, preserving Pi's own appends and the base prompt.
				...(memory
					? {
							appendSystemPromptOverride: (base) => {
								const ctx = memory.readContext();
								return ctx ? [...base, ctx] : base;
							},
						}
					: {}),
				extensionFactories,
			},
		});

		const model = modelRegistry.find(PROVIDER, MODEL_ID);
		if (!model) {
			throw new Error(`Model ${PROVIDER}/${MODEL_ID} is not registered. Set MINIPI_MODEL to a pulled Ollama tag.`);
		}

		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
				model,
				thinkingLevel: "off",
				tools: toolNames,
				customTools,
			})),
			services,
			diagnostics: services.diagnostics,
		};
	};

	return createAgentSessionRuntime(createRuntime, {
		cwd: process.cwd(),
		agentDir: getAgentDir(),
		sessionManager,
	});
}
