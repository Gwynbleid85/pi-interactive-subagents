/** Isolate legacy-backend tests from a developer's enclosing Core terminal. */
export function withoutCoreContext(): () => void {
  const keys = ["HC_TERMINAL_ID", "HC_TERMINAL_SOCKET", "HC_SOCKET"];
  const saved = keys.map(key => process.env[key]);
  for (const key of keys) delete process.env[key];
  return () => {
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  };
}
