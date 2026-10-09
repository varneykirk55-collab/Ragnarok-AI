export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  /** Provider-reported publication date; this is not Ragnarok's current date. */
  publishedAt?: string;
  /** Last-updated/edit timestamp when a provider exposes that instead. */
  updatedAt?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  provider: string;
  query: string;
  latencyMs: number;
}

export function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    copy: "©",
    hellip: "…",
    lsquo: "‘",
    ldquo: "“",
    mdash: "—",
    ndash: "–",
    rdquo: "”",
    rsquo: "’",
  };

  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/gi, (entity, body: string) => {
    if (body[0] !== "#") return named[body.toLowerCase()] ?? entity;
    const hexadecimal = body[1]?.toLowerCase() === "x";
    const codePoint = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return "";
    }
    return String.fromCodePoint(codePoint);
  });
}

export function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function getAttribute(attributes: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function unwrapDuckDuckGoUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(decodeHtmlEntities(rawUrl), "https://html.duckduckgo.com");
  } catch {
    return null;
  }

  if (/\bduckduckgo\.com$/i.test(parsed.hostname) && parsed.pathname === "/l/") {
    const destination = parsed.searchParams.get("uddg") || parsed.searchParams.get("rut");
    if (!destination) return null;
    try {
      parsed = new URL(destination);
    } catch {
      return null;
    }
  }

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  if (/\b(?:www\.)?duckduckgo\.com$/i.test(parsed.hostname)) return null;
  return parsed.toString();
}

/** Parse result links/snippets from DuckDuckGo's HTML response. */
export function parseDuckDuckGoResults(html: string, maxResults = 8): SearchResult[] {
  const snippets: string[] = [];
  const anchors = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchors.exec(html)) !== null) {
    if (/\bresult__snippet\b/i.test(getAttribute(match[1], "class"))) {
      snippets.push(stripHtml(match[2]).slice(0, 1000));
    }
  }

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let resultIndex = 0;
  anchors.lastIndex = 0;
  while ((match = anchors.exec(html)) !== null && results.length < maxResults) {
    if (!/\bresult__a\b/i.test(getAttribute(match[1], "class"))) continue;
    const candidateIndex = resultIndex++;
    const url = unwrapDuckDuckGoUrl(getAttribute(match[1], "href"));
    if (!url || seen.has(url)) continue;
    let parsed: URL;
    try { parsed = new URL(url); } catch { continue; }
    seen.add(url);
    results.push({
      title: stripHtml(match[2]).slice(0, 300) || parsed.hostname,
      url,
      snippet: snippets[candidateIndex] || "",
      source: parsed.hostname,
    });
  }
  return results;
}

/**
 * Keep only attributable HTTP(S) results and derive the source label from the
 * linked URL instead of trusting provider-supplied display text.
 */
export function normalizeSearchResults(results: unknown[], maxResults: number): SearchResult[] {
  const normalized: SearchResult[] = [];
  const seen = new Set<string>();
  for (const candidate of results) {
    if (!candidate || typeof candidate !== "object") continue;
    const value = candidate as Partial<SearchResult>;
    if (typeof value.url !== "string") continue;
    let parsed: URL;
    try { parsed = new URL(value.url); } catch { continue; }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || seen.has(parsed.toString())) continue;
    seen.add(parsed.toString());
    const dateField = (field: unknown) => typeof field === "string" && field.trim() ? field.trim().slice(0, 100) : undefined;
    normalized.push({
      title: stripHtml(typeof value.title === "string" ? value.title : "").slice(0, 300) || parsed.hostname,
      url: parsed.toString(),
      snippet: stripHtml(typeof value.snippet === "string" ? value.snippet : "").slice(0, 1200),
      source: parsed.hostname,
      ...(dateField(value.publishedAt) ? { publishedAt: dateField(value.publishedAt) } : {}),
      ...(dateField(value.updatedAt) ? { updatedAt: dateField(value.updatedAt) } : {}),
    });
    if (normalized.length >= maxResults) break;
  }
  return normalized;
}
