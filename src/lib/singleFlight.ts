/**
 * One in-flight run per key. A second call for the same key while a run is
 * pending shares that run's promise; a call for a different key starts a new
 * run and becomes the current one. When a run settles it clears the slot only
 * if it is still the current run, so an older run finishing late (say, the
 * previous video's transcript fetch after an in-page navigation) can never drop
 * a newer run and let a duplicate start.
 */
export function createKeyedSingleFlight<T>() {
  let current: { key: string; promise: Promise<T> } | null = null;
  return {
    run(key: string, start: () => Promise<T>): Promise<T> {
      if (current && current.key === key) return current.promise;
      const entry = { key, promise: start() };
      current = entry;
      const clear = () => {
        if (current === entry) current = null;
      };
      entry.promise.then(clear, clear);
      return entry.promise;
    },
    /** Forget the current run (it keeps running, but no caller joins it). */
    reset(): void {
      current = null;
    },
    /** The key of the run in flight, if any. */
    get key(): string | null {
      return current?.key ?? null;
    },
  };
}
