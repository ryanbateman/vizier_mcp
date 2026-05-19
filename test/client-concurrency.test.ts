import { describe, it, expect } from "vitest";
import {
  createSerializer,
  isRetryable,
  shouldRetry,
  MUTATING_METHODS,
  DFHackConnectionError,
  DFHackRPCError,
} from "../src/dfhack/client.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createSerializer (RPC mutex)", () => {
  it("runs tasks one at a time, in submission order", async () => {
    const run = createSerializer();
    let active = 0;
    const order: number[] = [];
    const task = (i: number, ms: number) =>
      run(async () => {
        active++;
        expect(active).toBe(1); // never overlaps
        await delay(ms);
        order.push(i);
        active--;
        return i;
      });
    const results = await Promise.all([task(1, 25), task(2, 5), task(3, 15)]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]); // FIFO despite differing durations
  });

  it("keeps serializing after a task rejects", async () => {
    const run = createSerializer();
    const seen: string[] = [];
    const a = run(async () => {
      seen.push("a");
      throw new Error("boom");
    });
    await expect(a).rejects.toThrow("boom");
    const b = await run(async () => {
      seen.push("b");
      return "ok";
    });
    expect(b).toBe("ok");
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("isRetryable", () => {
  it("treats transport failures as retryable", () => {
    expect(isRetryable(new DFHackConnectionError("RPC call timed out after 60000ms"))).toBe(true);
    expect(isRetryable(new Error("Not connected (status: disconnected)"))).toBe(true);
    expect(isRetryable(new Error("read ECONNRESET"))).toBe(true);
    expect(isRetryable(new Error("Disconnected"))).toBe(true);
  });

  it("does not retry server-side RPC failures or unknown errors", () => {
    expect(isRetryable(new DFHackRPCError("RPC call to X failed (target not found)", "X", 3))).toBe(false);
    expect(isRetryable(new Error("something unrelated"))).toBe(false);
  });
});

describe("shouldRetry", () => {
  const connErr = new DFHackConnectionError("timed out");

  it("retries idempotent reads on transient errors", () => {
    expect(shouldRetry("ListUnits", connErr)).toBe(true);
    expect(shouldRetry("GetUnitList", connErr)).toBe(true);
  });

  it("never retries mutating methods", () => {
    for (const m of MUTATING_METHODS) {
      expect(shouldRetry(m, connErr)).toBe(false);
    }
    expect(MUTATING_METHODS.has("SetUnitLabors")).toBe(true);
  });

  it("does not retry non-transient errors even for reads", () => {
    expect(shouldRetry("ListUnits", new DFHackRPCError("failed", "ListUnits", 2))).toBe(false);
  });
});
