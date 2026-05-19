export interface Page<T> {
  total: number;
  offset: number;
  limit: number;
  items: T[];
}

export interface SizedPage<T> extends Page<T> {
  /** Number of items actually returned after size-based shrinking. */
  returned: number;
  /** True when the page was shrunk below the requested limit due to size. */
  truncated: boolean;
  /** Where to start a follow-up page when truncated; omitted when not. */
  nextOffset?: number;
}

export function paginate<T>(items: T[], offset: number, limit: number): Page<T> {
  const start = Math.min(offset, items.length);
  const end = Math.min(start + limit, items.length);
  return {
    total: items.length,
    offset: start,
    limit,
    items: items.slice(start, end),
  };
}

/** Conservative default; overridable via env so live tuning needs no rebuild. */
function readMaxResponseChars(): number {
  const raw = process.env.VIZIER_MAX_RESPONSE_CHARS;
  if (!raw) return 40_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 40_000;
}

/**
 * Page by count, then shrink by size: if the serialized envelope exceeds the
 * char budget, drop trailing items until it fits (or one item remains).
 * Signals truncation via `truncated` + `nextOffset` so the caller can page.
 *
 * The default `measure` serializes the full candidate envelope (matching
 * jsonResult's 2-space indent) so the budget covers the actual wire payload,
 * not just the items array. `measure` and `maxChars` are injectable for tests.
 */
export function paginateBySize<T>(
  items: T[],
  offset: number,
  limit: number,
  options: { maxChars?: number; measure?: (page: SizedPage<T>) => number } = {},
): SizedPage<T> {
  const maxChars = options.maxChars ?? readMaxResponseChars();
  const measure =
    options.measure ?? ((page: SizedPage<T>) => JSON.stringify(page, null, 2).length);

  const base = paginate(items, offset, limit);
  let kept = base.items.slice();
  const requested = Math.min(limit, Math.max(0, items.length - base.offset));

  const build = (xs: T[]): SizedPage<T> => {
    const truncated = xs.length < requested;
    const page: SizedPage<T> = {
      total: base.total,
      offset: base.offset,
      limit,
      items: xs,
      returned: xs.length,
      truncated,
    };
    if (truncated) page.nextOffset = base.offset + xs.length;
    return page;
  };

  let candidate = build(kept);
  while (kept.length > 1 && measure(candidate) > maxChars) {
    kept = kept.slice(0, kept.length - 1);
    candidate = build(kept);
  }
  return candidate;
}
