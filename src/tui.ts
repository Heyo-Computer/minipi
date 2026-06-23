/**
 * minipi TUI entry point.
 *
 * Launches the Pi coding agent's built-in interactive terminal UI against the
 * local Ollama lfm2.5 model. Run with `npm run tui`.
 */

import { InteractiveMode, SessionManager } from "@earendil-works/pi-coding-agent";
import { buildRuntime } from "./runtime.ts";

const runtime = await buildRuntime(SessionManager.create(process.cwd()));
const mode = new InteractiveMode(runtime, {});
await mode.run();
