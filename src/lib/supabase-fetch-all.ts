/**
 * Paginate past PostgREST’s default ~1000-row cap.
 */
export async function fetchAllRows<T>(
  build: (
    from: number,
    to: number
  ) => PromiseLike<{
    data: T[] | null;
    error: { message?: string; code?: string } | null;
  }>
): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    out.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
