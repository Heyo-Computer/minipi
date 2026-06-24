/**
 * minipi JSON-RPC transport entry point.
 *
 * Runs the agent in RPC mode over stdio using the Pi SDK's JSONL framing.
 * The transport is strict LF-delimited JSONL: each request and each response
 * is a single JSON object on one line, terminated by `\n`. Clients must split
 * the stream on `\n` only (do not use a generic line reader that also splits
 * on `\r`). Run with `npm run rpc`.
 */

import { runRpcMode, SessionManager } from "@earendil-works/pi-coding-agent";
import { config } from "./config.ts";
import { buildRuntime } from "./runtime.ts";

// With MINIPI_RESUME=1, continue the most recent persisted thread for this cwd
// (or start fresh if none); otherwise begin a new thread each launch.
const sessionManager = config.resume
	? SessionManager.continueRecent(process.cwd())
	: SessionManager.create(process.cwd());

const runtime = await buildRuntime(sessionManager);
await runRpcMode(runtime);
