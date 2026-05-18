export function paginate<T>(items: T[], offset: number, limit: number): { total: number; offset: number; limit: number; items: T[] } {
  const start = Math.min(offset, items.length);
  const end = Math.min(start + limit, items.length);
  return {
    total: items.length,
    offset: start,
    limit,
    items: items.slice(start, end),
  };
}
