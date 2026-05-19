import { describe, it, expect } from "vitest";
import { paginate, paginateBySize } from "../src/pagination.js";

describe("paginate", () => {
  const items = Array.from({ length: 100 }, (_, i) => `item-${i + 1}`);

  it("returns first page", () => {
    const result = paginate(items, 0, 20);
    expect(result.total).toBe(100);
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(20);
    expect(result.items.length).toBe(20);
    expect(result.items[0]).toBe("item-1");
    expect(result.items[19]).toBe("item-20");
  });

  it("returns middle page", () => {
    const result = paginate(items, 50, 20);
    expect(result.total).toBe(100);
    expect(result.offset).toBe(50);
    expect(result.items.length).toBe(20);
    expect(result.items[0]).toBe("item-51");
    expect(result.items[19]).toBe("item-70");
  });

  it("returns last page with partial items", () => {
    const result = paginate(items, 90, 20);
    expect(result.total).toBe(100);
    expect(result.offset).toBe(90);
    expect(result.items.length).toBe(10);
  });

  it("handles empty collection", () => {
    const result = paginate([], 0, 20);
    expect(result.total).toBe(0);
    expect(result.offset).toBe(0);
    expect(result.items.length).toBe(0);
  });

  it("handles limit larger than collection", () => {
    const small = ["a", "b", "c"];
    const result = paginate(small, 0, 20);
    expect(result.total).toBe(3);
    expect(result.items.length).toBe(3);
  });

  it("handles offset beyond collection", () => {
    const result = paginate(items, 200, 20);
    expect(result.offset).toBe(100);
    expect(result.items.length).toBe(0);
  });

  it("handles zero limit", () => {
    const result = paginate(items, 0, 0);
    expect(result.items.length).toBe(0);
    expect(result.total).toBe(100);
  });
});

describe("paginateBySize", () => {
  // Each item serializes to ~roughly 20+ chars under 2-space JSON, so a tiny
  // budget forces shrinking. Use an injected measure for deterministic math.
  const items = Array.from({ length: 50 }, (_, i) => ({ i, payload: "x".repeat(50) }));
  // 100 chars per item; envelope wrapper is treated as free for tests.
  const fixedMeasure = (page: { items: { i: number; payload: string }[] }) =>
    page.items.length * 100;

  it("matches paginate envelope and adds returned/truncated when nothing trimmed", () => {
    const result = paginateBySize(items, 0, 10, {
      maxChars: 100_000,
      measure: fixedMeasure,
    });
    expect(result.total).toBe(50);
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(10);
    expect(result.items.length).toBe(10);
    expect(result.returned).toBe(10);
    expect(result.truncated).toBe(false);
    expect(result.nextOffset).toBeUndefined();
  });

  it("shrinks the page when serialized size exceeds the budget", () => {
    // 10 items @ 100 chars each = 1000 chars; budget 350 → keep 3 items.
    const result = paginateBySize(items, 0, 10, {
      maxChars: 350,
      measure: fixedMeasure,
    });
    expect(result.returned).toBe(3);
    expect(result.items.length).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.nextOffset).toBe(3);
  });

  it("keeps at least one item even under an impossibly small budget", () => {
    const result = paginateBySize(items, 0, 10, {
      maxChars: 1,
      measure: fixedMeasure,
    });
    expect(result.returned).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.nextOffset).toBe(1);
  });

  it("is not truncated when fewer items than limit and all fit", () => {
    const small = items.slice(0, 3);
    const result = paginateBySize(small, 0, 10, {
      maxChars: 100_000,
      measure: fixedMeasure,
    });
    expect(result.returned).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.nextOffset).toBeUndefined();
  });

  it("respects an offset and sets nextOffset relative to it", () => {
    const result = paginateBySize(items, 10, 10, {
      maxChars: 350,
      measure: fixedMeasure,
    });
    expect(result.offset).toBe(10);
    expect(result.returned).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.nextOffset).toBe(13);
  });

  it("default measure uses 2-space JSON.stringify length", () => {
    // No measure override: real serialization. With a 200-char budget the
    // 50-byte payload+envelope per item should force a small page.
    const result = paginateBySize(items, 0, 10, { maxChars: 200 });
    expect(result.returned).toBeGreaterThan(0);
    expect(result.returned).toBeLessThan(10);
    expect(result.truncated).toBe(true);
  });
});
