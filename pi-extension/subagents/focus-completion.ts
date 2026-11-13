import { isKeyRelease, matchesKey } from "@mariozechner/pi-tui";

/** Command-only completion; return undefined to preserve normal editor handling. */
export function createFocusCompletionHandler(
  ui: {
    getEditorText(): string;
    setEditorText(text: string): void;
    setStatus(key: string, text: string | undefined): void;
  },
  getNames: () => string[],
  isPromptOpen: () => boolean,
) {
  let cycle: { prefix: string; lastText: string; name: string } | undefined;

  return (data: string): { consume: true } | undefined => {
    // Raw listeners run before the TUI's normal Kitty key-release filtering.
    if (isKeyRelease(data)) return;
    if (!matchesKey(data, "tab") || isPromptOpen()) {
      cycle = undefined;
      return;
    }
    const text = ui.getEditorText();
    const match = /^\/subagent-focus[ \t]+([^\r\n]*)$/.exec(text);
    if (!match) {
      cycle = undefined;
      return;
    }
    if (cycle?.lastText !== text) cycle = undefined;
    const prefix = cycle ? cycle.prefix : match[1];
    const names = getNames().filter((name) => name.startsWith(prefix));
    const previousIndex = cycle?.lastText === text ? names.indexOf(cycle.name) : -1;
    if (names.length === 0) {
      // Keep an existing prefix if agents disappear briefly between Tabs.
      return { consume: true };
    }
    const name = names[(previousIndex + 1) % names.length];
    const nextText = `/subagent-focus ${name}`;
    ui.setEditorText(nextText);
    // Consuming raw input bypasses the TUI's normal redraw. Clearing our own
    // invisible status schedules one via the public API without replacing editors.
    ui.setStatus("subagent-focus-completion", undefined);
    cycle = { prefix, lastText: nextText, name };
    return { consume: true };
  };
}
