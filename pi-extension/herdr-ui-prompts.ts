import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/** Bridge Pi's native dialog lifecycle to Herdr's managed state reporter.
 * Keep this separate from herdr-agent-state.ts: Herdr overwrites that file.
 * Requires Pi's ui_prompt_start/end events (available in Pi 1.5.2).
 */
export default function herdrUiPrompts(pi: ExtensionAPI): void {
	// Pi coalesces nested/overlapping dialogs into one outer prompt span.
	// Own exactly one count in Herdr so duplicate events cannot clear another
	// extension's blocked signal or leave Herdr permanently blocked.
	let active = false;

	function release(): void {
		if (!active) return;
		active = false;
		pi.events.emit("herdr:blocked", { active: false });
	}

	pi.on("ui_prompt_start", (event, ctx) => {
		if (ctx.mode !== "tui" || active) return;
		active = true;
		pi.events.emit("herdr:blocked", {
			active: true,
			label: event.title || "Waiting for user input",
		});
	});

	pi.on("ui_prompt_end", (_event, ctx) => {
		if (ctx.mode === "tui") release();
	});

	// Covers reload/session replacement while a dialog owns the waiting signal.
	pi.on("session_shutdown", () => release());
}
