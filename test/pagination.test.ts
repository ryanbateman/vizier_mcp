import { describe, it, expect } from "vitest";
import { paginate } from "../src/pagination.js";

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
