// Identifies what a search result answers: the normalized query plus the filter.
// A result is shown only while its key matches what is typed and selected now,
// so a previous query's hits are never displayed (or opened with Enter) while
// the new one is pending.
export const normalizeQuery = (q: string) => q.trim().replace(/\s+/g, " ");
export const searchKey = (q: string, filter: string) => `${filter}\u0000${normalizeQuery(q).toLowerCase()}`;
