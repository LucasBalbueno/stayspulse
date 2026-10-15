import type { Page } from '../../shared/application/pagination.js';

export function page<T extends { id: string }>(rows: T[], limit: number, date: (item: T) => Date): Page<T> {
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  // Transforma o cursor em base64 para evitar problemas de caracteres nas URLs
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ date: date(last).toISOString(), id: last.id })).toString('base64url') : null;

  return { data, pagination: { hasMore, nextCursor } };
}
