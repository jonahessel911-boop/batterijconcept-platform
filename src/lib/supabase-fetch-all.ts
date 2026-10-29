/**
 * Paginate past PostgREST’s default ~1000-row cap.
 * Callers must `.order(...)` on a stable key (prefer unique `id`) before `.range`.
 */
export async function fetchAllRows<T>(
  build: (
    from: number,
    to: number
  ) => PromiseLike<{
    data: T[] | null;
    error: { message?: string; code?: string } | null;
  }>,
  opts?: { pageSize?: number; maxPages?: number }
): Promise<T[]> {
  const pageSize = opts?.pageSize ?? 1000;
  const maxPages = opts?.maxPages ?? 100;
  const out: T[] = [];
  let from = 0;
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    out.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
