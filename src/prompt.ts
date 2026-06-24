/**
 * Loads the agent's system prompt from an editable markdown file.
 *
 * The default file is `prompts/system.md` (shipped with minipi, resolved
 * relative to source so it works from any cwd); override the path with
 * MINIPI_SYSTEM_PROMPT_PATH. When the file is missing we return undefined and
 * the SDK falls back to its built-in default prompt.
 */

import { existsSync, readFileSync } from "node:fs";

export function loadSystemPrompt(path: string): string | undefined {
	if (!existsSync(path)) return undefined;
	const content = readFileSync(path, "utf8").trim();
	return content || undefined;
}
