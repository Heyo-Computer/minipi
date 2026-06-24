/**
 * PostgreSQL tools: run SQL and inspect the schema.
 *
 * Registered only when DATABASE_URL is set. Queries run with the full
 * privileges of the connection string, so point it at a database the agent is
 * allowed to touch.
 */

import { readFileSync } from "node:fs";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import pg from "pg";
import { Type } from "typebox";

/** Max rows echoed back to the model, to keep tool results bounded. */
const MAX_ROWS = 200;

export interface PostgresSslOptions {
	/** Value of DATABASE_SSL (disable | require | no-verify | verify). */
	mode?: string;
	/** Path to a CA certificate (PEM) for verification. */
	caCertPath?: string;
}

function textResult(text: string): { content: { type: "text"; text: string }[]; details: unknown } {
	return { content: [{ type: "text", text }], details: {} };
}

/** Format a pg error, appending a hint when it looks like a TLS/SSL config problem. */
function formatPgError(err: unknown): string {
	const message = (err as Error).message ?? String(err);
	if (/ssl|tls|encrypt|certificat/i.test(message)) {
		return `Postgres error: ${message}\nHint: this database's TLS setting may be wrong. Set DATABASE_SSL in .env (use "require" for managed cloud databases, "disable" for plain local Postgres).`;
	}
	return `Postgres error: ${message}`;
}

/** Translate DATABASE_SSL/DATABASE_CA_CERT into a node-postgres `ssl` option. */
function resolveSsl({ mode, caCertPath }: PostgresSslOptions): pg.PoolConfig["ssl"] {
	const normalized = (mode ?? "").trim().toLowerCase();
	if (caCertPath) {
		return { ca: readFileSync(caCertPath, "utf8"), rejectUnauthorized: true };
	}
	switch (normalized) {
		case "":
		case "disable":
		case "false":
		case "off":
			return undefined; // no TLS
		case "require":
		case "no-verify":
		case "allow":
		case "prefer":
			// Encrypt, but don't verify the cert — works with managed DBs whose
			// CA isn't in the local trust store.
			return { rejectUnauthorized: false };
		case "verify":
		case "verify-full":
		case "true":
		case "on":
			return { rejectUnauthorized: true };
		default:
			return { rejectUnauthorized: false };
	}
}

export function createPostgresTools(databaseUrl: string, ssl: PostgresSslOptions = {}): ToolDefinition[] {
	const pool = new pg.Pool({ connectionString: databaseUrl, max: 4, ssl: resolveSsl(ssl) });
	process.on("exit", () => {
		void pool.end();
	});

	const query = defineTool({
		name: "postgres_query",
		label: "Postgres Query",
		description:
			"Execute a SQL statement against the configured PostgreSQL database and return the rows as JSON. " +
			"Use $1, $2, ... placeholders with the `params` array for values instead of string-interpolating them.",
		parameters: Type.Object({
			sql: Type.String({ description: "SQL statement to execute. Use $1, $2, ... for parameters." }),
			params: Type.Optional(
				Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]), {
					description: "Positional parameter values for $1, $2, ... in order.",
				}),
			),
		}),
		execute: async (_id, { sql, params }) => {
			try {
				const res = await pool.query(sql, params as unknown[] | undefined);
				const rows = res.rows.slice(0, MAX_ROWS);
				const truncated = (res.rowCount ?? rows.length) > rows.length;
				return textResult(
					JSON.stringify(
						{
							command: res.command,
							rowCount: res.rowCount,
							rows,
							...(truncated ? { note: `truncated to first ${MAX_ROWS} rows` } : {}),
						},
						null,
						2,
					),
				);
			} catch (err) {
				return textResult(formatPgError(err));
			}
		},
	});

	const schema = defineTool({
		name: "postgres_schema",
		label: "Postgres Schema",
		description:
			"Inspect the public schema. With no `table`, lists all tables. With a `table`, lists its columns, types, nullability, and defaults.",
		parameters: Type.Object({
			table: Type.Optional(Type.String({ description: "Optional table name to describe." })),
		}),
		execute: async (_id, { table }) => {
			try {
				if (table) {
					const res = await pool.query(
						`select column_name, data_type, is_nullable, column_default
						 from information_schema.columns
						 where table_schema = 'public' and table_name = $1
						 order by ordinal_position`,
						[table],
					);
					if (res.rowCount === 0) return textResult(`No table named "${table}" in the public schema.`);
					return textResult(JSON.stringify(res.rows, null, 2));
				}
				const res = await pool.query(
					`select table_name from information_schema.tables
					 where table_schema = 'public' order by table_name`,
				);
				return textResult(JSON.stringify(res.rows.map((r) => r.table_name), null, 2));
			} catch (err) {
				return textResult(formatPgError(err));
			}
		},
	});

	return [query, schema];
}
