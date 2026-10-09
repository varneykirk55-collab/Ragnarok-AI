export const MAX_SEARCH_QUERY_LENGTH = 300;

/**
 * Normalize an actual query without dropping important topic words. Long
 * prompts are cut at a word boundary rather than searched as an entire essay.
 */
export function normalizeSearchQuery(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_SEARCH_QUERY_LENGTH) return normalized;
  const bounded = normalized.slice(0, MAX_SEARCH_QUERY_LENGTH);
  const wordBoundary = bounded.lastIndexOf(" ");
  return (wordBoundary > 0 ? bounded.slice(0, wordBoundary) : bounded).trim();
}

/**
 * Remove only common web-search directives around the user's question. The
 * question itself is kept intact; unlike broad sentence-removal regexes this
 * does not discard everything after words such as "instructions" or "format".
 */
export function buildSearchQuery(text: string): string {
  const original = text.replace(/\s+/g, " ").trim();
  if (!original) return "";

  let query = original.replace(/^(?:please\s+)?(?:can you|could you|would you)\s+/i, "");
  const startsWithSearchCommand = /^(?:please\s+)?(?:search|browse|look\s+up|find|google)\b/i.test(query);
  if (startsWithSearchCommand) {
    query = query
      .replace(/^(?:please\s+)?(?:search|browse|look\s+up|find|google)\s+/i, "")
      .replace(/^(?:(?:the|on the)\s+)?(?:live\s+)?(?:web|internet|online)(?:\s+(?:for|about))?\s*/i, "")
      .replace(/^(?:for|about)\s+/i, "")
      .replace(/^me\s+/i, "")
      .replace(/\s+(?:on(?: the)?\s+)?(?:web|internet|online)[.!?]*$/i, "");
  }

  query = query
    .replace(/^(?:please\s+)?(?:use|perform|do)\s+(?:a\s+)?(?:live\s+)?web\s+search\s*(?:for|about)?\s*[:,—-]?\s*/i, "")
    .replace(/(?:[,;.]?\s+)?(?:and\s+)?(?:please\s+)?(?:give|provide|include|show|list|cite)\s+(?:me\s+)?(?:the\s+)?(?:sources?|links?|citations?|urls?)(?:\s+as\s+well)?[.!?]*$/i, "")
    .replace(/(?:^|[.!?]\s*)do not answer from\b[^.!?]*(?=$|[.!?])/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // A directive-only request can still be meaningful; use the original text
  // rather than accidentally issuing an empty search.
  return normalizeSearchQuery(query || original);
}

/** Explicit web-search phrasing not covered by freshness heuristics. */
export function isExplicitWebSearchRequest(text: string): boolean {
  return /\b(?:search|browse|look\s+up|find|google)\b[^.!?\n]{0,120}\b(?:web|internet|online)\b/i.test(text)
    || /\b(?:web|internet)\s+search\b/i.test(text)
    || /\bsearch\s+(?:the\s+)?(?:web|internet|online)\b/i.test(text);
}
