import { describe, expect, it } from "vitest";
import { createKeyedSingleFlight } from "./singleFlight";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("createKeyedSingleFlight", () => {
  it("shares one run between callers for the same key", async () => {
    const flight = createKeyedSingleFlight<string>();
    let starts = 0;
    const d = deferred<string>();
    const a = flight.run("v1", () => { starts++; return d.promise; });
    const b = flight.run("v1", () => { starts++; return d.promise; });
    d.resolve("text");
    expect(await a).toBe("text");
    expect(await b).toBe("text");
    expect(starts).toBe(1);
  });

  it("an older run settling late does not clear a newer one", async () => {
    const flight = createKeyedSingleFlight<string>();
    const older = deferred<string>();
    const newer = deferred<string>();
    let newerStarts = 0;
    void flight.run("old-video", () => older.promise);
    void flight.run("new-video", () => { newerStarts++; return newer.promise; });
    older.resolve("old");
    await older.promise;
    await Promise.resolve();
    // The newer run is still in flight, so a caller for it joins it instead of
    // starting a duplicate.
    expect(flight.key).toBe("new-video");
    void flight.run("new-video", () => { newerStarts++; return newer.promise; });
    expect(newerStarts).toBe(1);
    newer.resolve("new");
    await newer.promise;
    await Promise.resolve();
    expect(flight.key).toBeNull();
  });

  it("clears the slot after a failed run", async () => {
    const flight = createKeyedSingleFlight<string>();
    await expect(flight.run("v1", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(flight.key).toBeNull();
  });
});
