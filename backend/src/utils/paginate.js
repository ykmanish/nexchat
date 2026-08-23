/** Cursor pagination on an ISO/ObjectId-sortable field. */
export function pageParams(query, { defaultLimit = 40, maxLimit = 100 } = {}) {
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  const before = query.before || null;
  const after = query.after || null;
  return { limit, before, after };
}
