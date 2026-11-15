/** Best-effort cleanup must not abandon other test children after one error. */
export function cleanupOwnedSurfaces(surfaces: string[], close: (surface: string) => void): void {
  const errors: unknown[] = [];
  for (const surface of surfaces) {
    try { close(surface); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Owned terminal cleanup failed");
}
