import { describe, it, expect, beforeEach, vi } from "vitest";

let saveId = "region1";
let callLog: string[] = [];
let statusListener: ((s: string) => void) | null = null;

const fakeClient = {
  onStatusChange(fn: (s: string) => void) {
    statusListener = fn;
  },
  async callTyped(method: string) {
    callLog.push(method);
    switch (method) {
      case "ListJobSkills":
        return { profession: [{ id: 1, key: "K", caption: "C" }], skill: [], labor: [] };
      case "ListEnums":
        return { unitFlags1: [], unitFlags2: [], unitFlags3: [], deathInfoFlags: [] };
      case "GetMaterialList":
        return { materialList: [{ matPair: { matType: 0, matIndex: 1 }, name: "Iron", id: "IRON" }] };
      case "GetItemList":
        return { materialList: [] };
      case "GetWorldInfo":
        return { saveDir: saveId, mode: 1 };
      case "GetCreatureRaws":
        return { creatureRaws: [{ index: 0, creatureId: "DWARF", name: ["dwarf"] }] };
      default:
        return {};
    }
  },
};

vi.mock("../src/dfhack/client.js", () => ({
  getClient: async () => fakeClient,
  callRpc: async (method: string, input?: Record<string, unknown>) =>
    fakeClient.callTyped(method, input),
}));

const { ensureLookups, invalidateLookups, getReferenceDataset } = await import(
  "../src/lookup-cache.js"
);

function count(method: string): number {
  return callLog.filter((m) => m === method).length;
}

describe("lookup-cache", () => {
  beforeEach(() => {
    invalidateLookups();
    callLog = [];
    saveId = "region1";
    vi.useRealTimers();
  });

  it("fetches lookups once and serves subsequent calls from cache (no GetWorldInfo within TTL)", async () => {
    const l1 = await ensureLookups();
    expect(l1.material.get("0/1")).toBe("Iron");
    expect(l1.creature?.get(0)).toBe("dwarf");
    expect(count("ListJobSkills")).toBe(1);

    const l2 = await ensureLookups();
    expect(l2).toBe(l1);
    expect(count("ListJobSkills")).toBe(1);
    // The only GetWorldInfo is the one from the initial fetch batch.
    expect(count("GetWorldInfo")).toBe(1);
  });

  it("dedups concurrent callers via the promise mutex", async () => {
    const [a, b] = await Promise.all([ensureLookups(), ensureLookups()]);
    expect(a).toBe(b);
    expect(count("ListJobSkills")).toBe(1);
  });

  it("invalidates on a disconnect status event", async () => {
    await ensureLookups();
    expect(count("ListJobSkills")).toBe(1);
    expect(statusListener).toBeTypeOf("function");
    statusListener!("disconnected");
    await ensureLookups();
    expect(count("ListJobSkills")).toBe(2);
  });

  it("revalidates after TTL and invalidates when the world changed", async () => {
    await ensureLookups();
    expect(count("ListJobSkills")).toBe(1);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000); // past the 60s world-check TTL
    saveId = "region2"; // simulate a different save loaded

    await ensureLookups();
    expect(count("ListJobSkills")).toBe(2); // re-fetched after save change
  });

  it("getReferenceDataset reuses datasets already pulled by ensureLookups", async () => {
    await ensureLookups();
    const before = count("GetMaterialList");
    const mats = await getReferenceDataset<{ materialList: unknown[] }>("materials");
    expect(mats.materialList).toHaveLength(1);
    expect(count("GetMaterialList")).toBe(before); // served from cache, no extra RPC
  });

  it("getReferenceDataset fetches uncached datasets on demand", async () => {
    await ensureLookups();
    await getReferenceDataset("tiletypes");
    expect(count("GetTiletypeList")).toBe(1);
  });
});
