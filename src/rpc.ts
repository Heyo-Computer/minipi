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
import { buildRuntime } from "./runtime.ts";

const runtime = await buildRuntime(SessionManager.create(process.cwd()));
await runRpcMode(runtime);
