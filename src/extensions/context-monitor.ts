/**
 * Context-pressure monitor: nudges the user to tidy the conversation once it
 * grows large, and registers a `/tidy` command to compact or clear it.
 *
 * Runs as an in-process Pi extension (wired via `resourceLoaderOptions.
 * extensionFactories` in `src/runtime.ts`). Small local models lose coherence as
 * the context fills, so we surface the built-in compaction/clear actions instead
 * of letting the window silently saturate.
 *
 * The suggestion is passive: a persistent footer hint plus a single warning
 * notification when usage first crosses the threshold — it never compacts on its
 * own. The TUI footer already shows the raw percentage; this adds the call to
 * action.
 */

import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "context";

/** Read the current context usage as a whole-number percent, or null if unknown. */
function usagePercent(ctx: ExtensionContext): number | null {
	const usage = ctx.getContextUsage();
	if (!usage || usage.percent === null) return null;
	return Math.round(usage.percent);
}

export function createContextMonitor({ warnPercent }: { warnPercent: number }): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		// True once we've notified for the current high-usage spell; reset when
		// usage drops back below the threshold (e.g. after compact/clear).
		let warned = false;

		const clear = (ctx: ExtensionContext) => {
			warned = false;
			ctx.ui.setStatus(STATUS_KEY, undefined);
		};

		pi.on("turn_end", async (_event, ctx) => {
			const percent = usagePercent(ctx);
			if (percent === null) return;

			if (percent < warnPercent) {
				if (warned) clear(ctx);
				return;
			}

			ctx.ui.setStatus(STATUS_KEY, `⚠ context ${percent}% — /tidy to compact or clear`);
			if (!warned) {
				warned = true;
				ctx.ui.notify(`Context is ${percent}% full. Run /tidy to compact (summarize) or clear it.`, "warning");
			}
		});

		// A fresh or resumed session starts with a clean slate.
		pi.on("session_start", async (_event, ctx) => clear(ctx));

		pi.registerCommand("tidy", {
			description: "Compact (summarize) or clear the conversation context",
			handler: async (_args, ctx) => {
				const percent = usagePercent(ctx);
				const title = percent === null ? "Tidy the context?" : `Context is ${percent}% full — tidy how?`;
				const compact = "Compact (summarize & continue)";
				const reset = "Clear (start fresh)";

				const choice = await ctx.ui.select(title, [compact, reset, "Cancel"]);
				if (choice === compact) {
					ctx.compact();
					ctx.ui.setStatus(STATUS_KEY, undefined);
				} else if (choice === reset) {
					await ctx.newSession();
				}
			},
		});
	};
}
