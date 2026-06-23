# minipi

A minimal local coding-agent harness built on the
[Pi coding agent SDK](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).
It runs **fully local** against [Ollama](https://ollama.com) with Liquid AI's
**lfm2.5** model, and exposes two entry points:

- **TUI** — Pi's built-in interactive terminal UI.
- **JSON-RPC** — Pi's headless RPC transport (LF-delimited JSONL over stdio).

### Tools

Always on (built in to the SDK): **`bash`**, **`read`**, **`write`**.

Opt-in via `.env` (registered only when configured):

| Tool(s)                            | Enabled by      | What it does                                            |
| ---------------------------------- | --------------- | ------------------------------------------------------- |
| `postgres_query`, `postgres_schema`| `DATABASE_URL`  | Run SQL and introspect tables/columns on PostgreSQL.    |
| `web_search`                       | `TAVILY_API_KEY`| Web search via [Tavily](https://tavily.com).            |
| `<server>__<tool>`                 | `MCP_SERVERS`   | Every tool from each configured stdio MCP server.       |

## How it works

`src/runtime.ts` registers Ollama as an OpenAI-compatible provider
(`http://localhost:11434/v1`) directly via the SDK's `ModelRegistry.registerProvider`,
selects the lfm2.5 model, and builds the tool set. The built-in `read`/`write`/`bash`
tools are combined with the optional custom tools assembled in `src/tools/` and passed to
the session as `customTools`. Both entry points share that runtime:

- `src/tui.ts` → `new InteractiveMode(runtime).run()`
- `src/rpc.ts` → `runRpcMode(runtime)`

The custom tools (auth/connections) are built **once** per process and closed over by the
runtime factory, so MCP servers and the Postgres pool connect a single time and survive
session replacement.

MCP tools forward their server's JSON Schema `inputSchema` straight through as the Pi
tool's `parameters` — Pi's validator accepts plain JSON Schema, so no schema conversion is
needed.

## Prerequisites

1. [Install Ollama](https://ollama.com/download) and start the server:
   ```bash
   ollama serve
   ```
2. Pull the model (1.2B instruct, ~730 MB, supports tool calling):
   ```bash
   ollama pull LiquidAI/lfm2.5-1.2b-instruct
   ```
   Confirm it is served on the OpenAI-compatible endpoint:
   ```bash
   curl -s http://localhost:11434/v1/models | grep lfm2.5
   ```
3. Install dependencies:
   ```bash
   npm install --ignore-scripts
   ```
4. Configure (optional integrations):
   ```bash
   cp .env.example .env   # then edit
   ```

## Usage

```bash
npm run tui   # interactive terminal UI
npm run rpc   # JSON-RPC transport on stdin/stdout
npm run typecheck
```

## Configuration

All configuration is a single `.env` file in the project root (real environment variables
take precedence). See `.env.example`. Every integration is **optional** — its tools are
only registered when the relevant key is present.

| Env var           | Default                          | Description                                       |
| ----------------- | -------------------------------- | ------------------------------------------------- |
| `MINIPI_MODEL`    | `LiquidAI/lfm2.5-1.2b-instruct`  | Ollama model tag (must match `ollama list`).      |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1`      | Ollama OpenAI-compatible endpoint.                |
| `DATABASE_URL`    | _(unset)_                        | PostgreSQL connection string → postgres tools.    |
| `TAVILY_API_KEY`  | _(unset)_                        | Tavily API key → `web_search`.                    |
| `TAVILY_BASE_URL` | `https://api.tavily.com`         | Tavily API base URL.                              |
| `MCP_SERVERS`     | _(unset)_                        | JSON array of stdio MCP servers (see below).      |

`MCP_SERVERS` is a JSON array of `{ name, command, args?, env? }` stdio servers. Each
server's tools are exposed as `<name>__<tool>`:

```bash
MCP_SERVERS='[{"name":"fs","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}]'
```

> Postgres SQL runs with the full privileges of `DATABASE_URL`. Point it at a database the
> agent is allowed to modify.

To use a different lfm2.5 variant (e.g. the 8.5B MoE already in your library):

```bash
MINIPI_MODEL=lfm2.5:latest npm run tui
```

## JSON-RPC protocol

Commands are JSON objects sent on stdin, one per line; responses and events are JSON
objects emitted on stdout, one per line. **Framing is strict LF (`\n`) only** — split the
stream on `\n`, not with a generic line reader (Node's `readline` is *not* compliant
because it also splits on `U+2028`/`U+2029`).

Example exchange (a prompt that drives a tool call):

```jsonc
// stdin
{"id":"1","type":"prompt","message":"create hello.txt containing hi"}
// stdout (abridged)
{"id":"1","type":"response","command":"prompt","success":true}
{"type":"agent_start"}
{"type":"tool_execution_start","toolName":"write"}
{"type":"tool_execution_end","toolName":"write"}
{"type":"agent_end"}
```

Other useful commands: `{"type":"get_state"}`, `{"type":"get_last_assistant_text"}`,
`{"type":"abort"}`, `{"type":"new_session"}`. See the SDK's `rpc.md` for the full set.
